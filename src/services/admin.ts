import type { AdminDashboardData } from "../types/admin";
import { invokeAuthedEdgeFunction } from "./edgeFetch";

export async function fetchAdminDashboard(): Promise<AdminDashboardData> {
  return invokeAuthedEdgeFunction<AdminDashboardData>("admin-dashboard", {
    action: "dashboard",
  });
}

export async function updateUserPremiumStatus(params: {
  userId: string;
  isPremium: boolean;
}): Promise<void> {
  await invokeAuthedEdgeFunction("admin-dashboard", {
    action: "setPremium",
    userId: params.userId,
    isPremium: params.isPremium,
  });
}
