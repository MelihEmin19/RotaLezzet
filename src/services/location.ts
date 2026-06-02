import * as Location from "expo-location";

export type UserLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
};

export async function requestForegroundUserLocation(): Promise<UserLocation | null> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return null;

  const position = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.Balanced,
  });

  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
  };
}
