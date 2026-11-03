export const roles = ["admin", "student", "warden", "security_guard"];
export function homeFor(profile) {
  if (!profile?.is_active || !roles.includes(profile.role)) return "/unauthorized";
  return profile.role === "security_guard" ? "/gate/scan" : `/${profile.role}/dashboard`;
}
export function canAccess(profile, role) {
  return Boolean(profile?.is_active && profile.role === role);
}
