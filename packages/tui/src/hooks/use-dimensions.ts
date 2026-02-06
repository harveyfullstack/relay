import { useState, useEffect } from 'react';

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Track terminal dimensions and re-render on resize.
 */
export function useDimensions(): Dimensions {
  const [dimensions, setDimensions] = useState<Dimensions>({
    width: process.stdout.columns ?? 80,
    height: process.stdout.rows ?? 24,
  });

  useEffect(() => {
    const handler = () => {
      setDimensions({
        width: process.stdout.columns ?? 80,
        height: process.stdout.rows ?? 24,
      });
    };

    process.stdout.on('resize', handler);
    return () => {
      process.stdout.off('resize', handler);
    };
  }, []);

  return dimensions;
}
