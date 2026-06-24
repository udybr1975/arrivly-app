export function getDirectionsUrl(lat: number, lng: number, mode = 'walking'): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=${mode}`
}
