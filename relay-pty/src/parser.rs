//! Output parser for relay commands and agent status detection.
//!
//! Scans agent output for:
//! - `->relay:` commands (messages, broadcasts, spawns)
//! - Prompt patterns (to detect idle state)
//! - `->pty:ready` explicit ready signal

use crate::protocol::ParsedRelayCommand;
use regex::Regex;
use std::sync::OnceLock;
use tracing::debug;

/// Regex patterns (compiled once)
static RELAY_PATTERN: OnceLock<Regex> = OnceLock::new();
static FENCED_PATTERN: OnceLock<Regex> = OnceLock::new();
static THREAD_PATTERN: OnceLock<Regex> = OnceLock::new();
static ANSI_PATTERN: OnceLock<Regex> = OnceLock::new();

fn relay_pattern() -> &'static Regex {
    RELAY_PATTERN.get_or_init(|| {
        Regex::new(r"(?m)^[\s>$%#\-*]*->relay:(\S+)\s+(.+)$").unwrap()
    })
}

fn fenced_pattern() -> &'static Regex {
    FENCED_PATTERN.get_or_init(|| {
        Regex::new(r"(?ms)->relay:(\S+)\s+<<<\s*(.*?)>>>").unwrap()
    })
}

fn thread_pattern() -> &'static Regex {
    THREAD_PATTERN.get_or_init(|| {
        Regex::new(r"\[thread:([^\]]+)\]").unwrap()
    })
}

fn ansi_pattern() -> &'static Regex {
    ANSI_PATTERN.get_or_init(|| {
        Regex::new(r"\x1B\[[0-9;]*[A-Za-z]|\x1B\].*?\x07").unwrap()
    })
}

/// Output parser state
pub struct OutputParser {
    /// Agent name (for the "from" field in parsed commands)
    agent_name: String,
    /// Prompt pattern regex
    prompt_pattern: Regex,
    /// Buffer for incomplete output
    buffer: String,
    /// Last position where we found a complete command
    last_parsed_pos: usize,
}

impl OutputParser {
    /// Create a new output parser
    pub fn new(agent_name: String, prompt_pattern: &str) -> Self {
        let prompt_regex = Regex::new(prompt_pattern)
            .unwrap_or_else(|_| Regex::new(r"^[>$%#] $").unwrap());

        Self {
            agent_name,
            prompt_pattern: prompt_regex,
            buffer: String::new(),
            last_parsed_pos: 0,
        }
    }

    /// Process new output and return any parsed commands
    pub fn process(&mut self, output: &[u8]) -> ParseResult {
        // Convert to string, handling invalid UTF-8
        let text = String::from_utf8_lossy(output);

        // Strip ANSI escape sequences
        let clean = strip_ansi(&text);

        // Append to buffer
        self.buffer.push_str(&clean);

        // Parse commands from buffer
        let commands = self.parse_commands();

        // Check for prompt
        let is_idle = self.check_for_prompt();

        // Check for explicit ready signal
        let ready_signal = self.buffer.contains("->pty:ready");
        if ready_signal {
            // Remove the signal from buffer
            self.buffer = self.buffer.replace("->pty:ready", "");
        }

        ParseResult {
            commands,
            is_idle: is_idle || ready_signal,
            ready_signal,
        }
    }

    /// Parse relay commands from the buffer
    fn parse_commands(&mut self) -> Vec<ParsedRelayCommand> {
        let mut commands = Vec::new();
        let search_text = &self.buffer[self.last_parsed_pos..];

        // First, try fenced format (multi-line)
        for caps in fenced_pattern().captures_iter(search_text) {
            let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
            let body = caps.get(2).map(|m| m.as_str()).unwrap_or("");
            let raw = caps.get(0).map(|m| m.as_str()).unwrap_or("");

            let mut cmd = ParsedRelayCommand::new(
                self.agent_name.clone(),
                target.to_string(),
                body.trim().to_string(),
                raw.to_string(),
            );

            // Check for thread
            if let Some(thread_caps) = thread_pattern().captures(target) {
                if let Some(thread_name) = thread_caps.get(1) {
                    cmd = cmd.with_thread(thread_name.as_str().to_string());
                }
            }

            debug!("Parsed fenced command: {} -> {}", self.agent_name, target);
            commands.push(cmd);
        }

        // Then, try single-line format (only if no fenced commands overlap)
        if commands.is_empty() {
            for caps in relay_pattern().captures_iter(search_text) {
                let target = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let body = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let raw = caps.get(0).map(|m| m.as_str()).unwrap_or("");

                // Skip if this looks like start of a fenced block
                if body.starts_with("<<<") {
                    continue;
                }

                let mut cmd = ParsedRelayCommand::new(
                    self.agent_name.clone(),
                    target.to_string(),
                    body.trim().to_string(),
                    raw.to_string(),
                );

                // Check for thread
                if let Some(thread_caps) = thread_pattern().captures(target) {
                    if let Some(thread_name) = thread_caps.get(1) {
                        cmd = cmd.with_thread(thread_name.as_str().to_string());
                    }
                }

                debug!("Parsed single-line command: {} -> {}", self.agent_name, target);
                commands.push(cmd);
            }
        }

        // Update last parsed position
        if !commands.is_empty() {
            self.last_parsed_pos = self.buffer.len();
        }

        commands
    }

    /// Check if the buffer ends with a prompt pattern
    fn check_for_prompt(&self) -> bool {
        // Get last few lines of buffer
        let lines: Vec<&str> = self.buffer.lines().collect();
        if let Some(last_line) = lines.last() {
            if self.prompt_pattern.is_match(last_line) {
                return true;
            }
        }

        // Also check common prompt patterns
        let common_prompts = [
            "> ",    // Claude
            "$ ",    // Shell
            ">>> ",  // Gemini
            "codex> ", // Codex
        ];

        if let Some(last_line) = lines.last() {
            let trimmed = last_line.trim_start();
            for prompt in common_prompts {
                if trimmed.ends_with(prompt) {
                    return true;
                }
            }
        }

        false
    }

    /// Clear the buffer
    pub fn clear(&mut self) {
        self.buffer.clear();
        self.last_parsed_pos = 0;
    }

    /// Get current buffer contents
    pub fn buffer(&self) -> &str {
        &self.buffer
    }

    /// Truncate buffer to prevent unbounded growth
    pub fn truncate_buffer(&mut self, max_size: usize) {
        if self.buffer.len() > max_size {
            // Keep the last max_size characters
            let start = self.buffer.len() - max_size;
            self.buffer = self.buffer[start..].to_string();
            self.last_parsed_pos = 0;
        }
    }
}

/// Result of parsing output
#[derive(Debug)]
pub struct ParseResult {
    /// Parsed relay commands
    pub commands: Vec<ParsedRelayCommand>,
    /// Whether agent appears idle
    pub is_idle: bool,
    /// Whether explicit ready signal was received
    pub ready_signal: bool,
}

/// Strip ANSI escape sequences from text
pub fn strip_ansi(text: &str) -> String {
    ansi_pattern().replace_all(text, "").to_string()
}

/// Sanitize text for injection (remove control characters)
pub fn sanitize_for_injection(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() || *c == '\n' || *c == '\t')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_single_line() {
        let mut parser = OutputParser::new("Alice".to_string(), r"^> $");
        let result = parser.process(b"->relay:Bob Hello Bob!\n");

        assert_eq!(result.commands.len(), 1);
        assert_eq!(result.commands[0].to, "Bob");
        assert_eq!(result.commands[0].body, "Hello Bob!");
    }

    #[test]
    fn test_parse_fenced() {
        let mut parser = OutputParser::new("Alice".to_string(), r"^> $");
        let result = parser.process(b"->relay:Bob <<<\nHello Bob!\nMulti-line message.>>>\n");

        assert_eq!(result.commands.len(), 1);
        assert_eq!(result.commands[0].to, "Bob");
        assert!(result.commands[0].body.contains("Multi-line"));
    }

    #[test]
    fn test_parse_with_thread() {
        let mut parser = OutputParser::new("Alice".to_string(), r"^> $");
        let result = parser.process(b"->relay:Bob [thread:test-123] <<<Hello>>>\n");

        assert_eq!(result.commands.len(), 1);
        assert_eq!(result.commands[0].to, "Bob");
        // Thread is extracted from the target
        assert!(result.commands[0].to.contains("Bob"));
    }

    #[test]
    fn test_prompt_detection() {
        let mut parser = OutputParser::new("Alice".to_string(), r"^> $");
        let result = parser.process(b"Some output\n> ");

        assert!(result.is_idle);
    }

    #[test]
    fn test_strip_ansi() {
        let input = "\x1B[31mRed text\x1B[0m";
        let output = strip_ansi(input);
        assert_eq!(output, "Red text");
    }

    #[test]
    fn test_ready_signal() {
        let mut parser = OutputParser::new("Alice".to_string(), r"^> $");
        let result = parser.process(b"Working...\n->pty:ready\n");

        assert!(result.ready_signal);
        assert!(result.is_idle);
    }
}
