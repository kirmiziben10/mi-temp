/** Same comfort zone as the previous app (and the sensor's own face icon): 19–27 °C, 20–85 %. */
export function isComfortable(temperature: number, humidity: number): boolean {
  return temperature >= 19 && temperature <= 27 && humidity >= 20 && humidity <= 85;
}
