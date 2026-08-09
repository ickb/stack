export const chartWidth = 640;
export const chartHeight = 132;
export const padding = {
  top: 18,
  bottom: 34,
};
export const plotPadding = {
  left: 10,
  right: 34,
};

export function scaleX(value: number, min: number, max: number): number {
  return (
    plotPadding.left +
    ((value - min) * (chartWidth - plotPadding.left - plotPadding.right)) / (max - min)
  );
}

export function scaleY(value: number, min: number, max: number): number {
  return (
    chartHeight -
    padding.bottom -
    ((value - min) * (chartHeight - padding.top - padding.bottom)) / (max - min)
  );
}
