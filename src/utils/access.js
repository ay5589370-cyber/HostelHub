export const roles = ["admin", "student", "warden", "security"];
export function homeFor(profile) {
  return profile?.is_active && roles.includes(profile.role)
    ? `/${profile.role}/dashboard`
    : "/unauthorized";
}
export function canAccess(profile, role) {
  return Boolean(profile?.is_active && profile.role === role);
}
