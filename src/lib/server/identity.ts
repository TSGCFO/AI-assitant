import { headers } from "next/headers";

const sanitize = (value: string): string => value.trim().toLowerCase();

export const resolveIdentity = async (): Promise<{ userId: string }> => {
  const headerStore = await headers();
  const explicitUserId = headerStore.get("x-user-id");
  const deviceId = headerStore.get("x-device-id");

  if (explicitUserId) {
    return { userId: `user:${sanitize(explicitUserId)}` };
  }

  if (deviceId) {
    return { userId: `guest:${sanitize(deviceId)}` };
  }

  return { userId: "guest:anonymous" };
};

