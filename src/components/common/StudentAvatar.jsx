import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { UserAvatar } from "./Feedback";
export function StudentAvatar({ student }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (!student?.profile_photo_path) {
        if (alive) setUrl(null);
        return;
      }
      const { data } = await supabase.storage
        .from("student-avatars")
        .createSignedUrl(student.profile_photo_path, 300);
      if (alive) setUrl(data?.signedUrl || null);
    };
    void refresh();
    const timer = setInterval(refresh, 240000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [student?.profile_photo_path]);
  return url ? (
    <img
      className="student-avatar"
      src={url}
      alt={`${student.full_name}'s profile`}
      onError={() => setUrl(null)}
    />
  ) : (
    <UserAvatar name={student?.full_name} />
  );
}
