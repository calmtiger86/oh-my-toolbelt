// Coordinates of the weatherPlace cities (plugin.json), so the forecast is asked by position and no
// place name is sent anywhere. Taken from Open-Meteo geocoding on 2026-10-23 (first result, checked).
// A short list of commonly picked cities; open an issue to add one. 63 of them, so with `off` the list stays within
// the 64 options /config's Select shows.
export const CITY_COORDS: Readonly<Record<string, { lat: number; lon: number }>> = {
  "Seoul": { lat: 37.566, lon: 126.9784 }, // South Korea
  "Busan": { lat: 35.1017, lon: 129.03 }, // South Korea
  "Incheon": { lat: 37.4565, lon: 126.7052 }, // South Korea
  "Daegu": { lat: 35.8703, lon: 128.5911 }, // South Korea
  "Daejeon": { lat: 36.3491, lon: 127.3849 }, // South Korea
  "Gwangju": { lat: 35.1547, lon: 126.9156 }, // South Korea
  "Jeju City": { lat: 33.5097, lon: 126.5219 }, // South Korea
  "Tokyo": { lat: 35.6895, lon: 139.6917 }, // Japan
  "Osaka": { lat: 34.6938, lon: 135.5011 }, // Japan
  "Taipei": { lat: 25.0531, lon: 121.5264 }, // Taiwan
  "Singapore": { lat: 1.2897, lon: 103.8501 }, // Singapore
  "Bangkok": { lat: 13.754, lon: 100.5014 }, // Thailand
  "Hanoi": { lat: 21.0245, lon: 105.8412 }, // Vietnam
  "Ho Chi Minh City": { lat: 10.823, lon: 106.6296 }, // Vietnam
  "Jakarta": { lat: -6.2146, lon: 106.8451 }, // Indonesia
  "Kuala Lumpur": { lat: 3.1412, lon: 101.6865 }, // Malaysia
  "Mumbai": { lat: 19.0728, lon: 72.8826 }, // India
  "Delhi": { lat: 28.6519, lon: 77.2315 }, // India
  "Bengaluru": { lat: 12.9719, lon: 77.5937 }, // India
  "Dubai": { lat: 25.0772, lon: 55.3093 }, // United Arab Emirates
  "Istanbul": { lat: 41.0138, lon: 28.9497 }, // Republic of Türkiye
  "London": { lat: 51.5085, lon: -0.1257 }, // United Kingdom
  "Paris": { lat: 48.8534, lon: 2.3488 }, // France
  "Berlin": { lat: 52.5244, lon: 13.4105 }, // Germany
  "Madrid": { lat: 40.4165, lon: -3.7026 }, // Spain
  "Barcelona": { lat: 41.3888, lon: 2.159 }, // Spain
  "Rome": { lat: 41.8919, lon: 12.5113 }, // Italy
  "Milan": { lat: 45.4643, lon: 9.1895 }, // Italy
  "Amsterdam": { lat: 52.374, lon: 4.8897 }, // The Netherlands
  "Brussels": { lat: 50.8505, lon: 4.3488 }, // Belgium
  "Zurich": { lat: 47.3667, lon: 8.55 }, // Switzerland
  "Vienna": { lat: 48.2085, lon: 16.3721 }, // Austria
  "Stockholm": { lat: 59.3294, lon: 18.0687 }, // Sweden
  "Copenhagen": { lat: 55.6759, lon: 12.5655 }, // Denmark
  "Oslo": { lat: 59.9127, lon: 10.7461 }, // Norway
  "Helsinki": { lat: 60.1695, lon: 24.9354 }, // Finland
  "Warsaw": { lat: 52.2298, lon: 21.0118 }, // Poland
  "Prague": { lat: 50.088, lon: 14.4208 }, // Czechia
  "Lisbon": { lat: 38.7251, lon: -9.1498 }, // Portugal
  "Dublin": { lat: 53.3331, lon: -6.2489 }, // Ireland
  "Athens": { lat: 37.9838, lon: 23.7278 }, // Greece
  "New York": { lat: 40.7143, lon: -74.006 }, // United States
  "Boston": { lat: 42.3584, lon: -71.0598 }, // United States
  "Chicago": { lat: 41.85, lon: -87.65 }, // United States
  "Toronto": { lat: 43.7064, lon: -79.3986 }, // Canada
  "Montreal": { lat: 45.5088, lon: -73.5878 }, // Canada
  "Vancouver": { lat: 49.2497, lon: -123.1193 }, // Canada
  "San Francisco": { lat: 37.7749, lon: -122.4194 }, // United States
  "Los Angeles": { lat: 34.0522, lon: -118.2437 }, // United States
  "Seattle": { lat: 47.6062, lon: -122.3321 }, // United States
  "Denver": { lat: 39.7392, lon: -104.9847 }, // United States
  "Austin": { lat: 30.2672, lon: -97.7431 }, // United States
  "Miami": { lat: 25.7743, lon: -80.1937 }, // United States
  "Mexico City": { lat: 19.4285, lon: -99.1277 }, // Mexico
  "Sao Paulo": { lat: -23.5475, lon: -46.6361 }, // Brazil
  "Rio de Janeiro": { lat: -22.9064, lon: -43.1822 }, // Brazil
  "Buenos Aires": { lat: -34.6131, lon: -58.3772 }, // Argentina
  "Johannesburg": { lat: -26.2023, lon: 28.0436 }, // South Africa
  "Cape Town": { lat: -33.9258, lon: 18.4232 }, // South Africa
  "Sydney": { lat: -33.8678, lon: 151.2073 }, // Australia
  "Melbourne": { lat: -37.814, lon: 144.9633 }, // Australia
  "Brisbane": { lat: -27.4679, lon: 153.0281 }, // Australia
  "Auckland": { lat: -36.8485, lon: 174.7635 }, // New Zealand
}
