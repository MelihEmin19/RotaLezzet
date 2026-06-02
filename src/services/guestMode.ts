import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "rotalezzet.guest_mode_v1";

export async function isGuestMode(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(STORAGE_KEY);
    return v === "1";
  } catch {
    return false;
  }
}

export async function setGuestMode(enabled: boolean): Promise<void> {
  try {
    if (enabled) {
      await AsyncStorage.setItem(STORAGE_KEY, "1");
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore
  }
}
