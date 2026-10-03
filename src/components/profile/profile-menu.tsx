"use client";

import { useEffect, useRef, useState } from "react";

interface User {
  id: string;
  name: string;
  email: string;
}

const NATIONALITIES = [
  ["HK", "Hong Kong"],
  ["CN", "China"],
  ["JP", "Japan"],
  ["KR", "South Korea"],
  ["SG", "Singapore"],
  ["TW", "Taiwan"],
  ["MY", "Malaysia"],
  ["TH", "Thailand"],
  ["IN", "India"],
  ["US", "United States"],
  ["GB", "United Kingdom"],
  ["AU", "Australia"],
] as const;

const DEFAULT_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%238099d4'/%3E%3Ccircle cx='48' cy='39' r='18' fill='%23fbf6ea'/%3E%3Cpath d='M18 88c3-20 14-30 30-30s27 10 30 30' fill='%23fbf6ea'/%3E%3C/svg%3E";

export function ProfileMenu() {
  const [user, setUser] = useState<User | null>(null);
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [avatar, setAvatar] = useState(DEFAULT_AVATAR);
  const [nationality, setNationality] = useState("HK");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => response.json())
      .then((data: { user: User | null }) => {
        setUser(data.user);
        if (data.user) {
          setAvatar(localStorage.getItem(`trip-globe-avatar:${data.user.id}`) || DEFAULT_AVATAR);
          setNationality(localStorage.getItem(`trip-globe-nationality:${data.user.id}`) || "HK");
        }
      })
      .catch(() => setUser(null));
  }, []);

  function chooseAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !user || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      setAvatar(reader.result);
      localStorage.setItem(`trip-globe-avatar:${user.id}`, reader.result);
    };
    reader.readAsDataURL(file);
  }

  function changeNationality(value: string) {
    setNationality(value);
    if (user) localStorage.setItem(`trip-globe-nationality:${user.id}`, value);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setOpen(false);
    setSettings(false);
  }

  if (!user) {
    return (
      <a className="profile-sign-in" href="/api/auth/google">
        Sign in with Google
      </a>
    );
  }

  return (
    <div className="profile-menu">
      <button className="profile-trigger" type="button" aria-label="Open profile" aria-expanded={open} onClick={() => setOpen(!open)}>
        <img src={avatar} alt="" />
      </button>
      {open ? (
        <div className="profile-popover" role="dialog" aria-label="Profile">
          {!settings ? (
            <>
              <div className="profile-summary">
                <img src={avatar} alt="" />
                <div>
                  <strong>{user.name}</strong>
                  <span>{user.email}</span>
                </div>
              </div>
              <button className="profile-action" type="button" onClick={() => setSettings(true)}>Settings</button>
              <button className="profile-action profile-sign-out" type="button" onClick={signOut}>Sign out</button>
            </>
          ) : (
            <>
              <div className="profile-settings-head">
                <button type="button" className="profile-back" onClick={() => setSettings(false)}>Back</button>
                <strong>Settings</strong>
              </div>
              <label className="profile-upload">
                <img src={avatar} alt="" />
                <span>Change avatar</span>
                <input ref={fileInput} type="file" accept="image/*" onChange={chooseAvatar} />
              </label>
              <label className="profile-field">
                <span>Nationality</span>
                <select value={nationality} onChange={(event) => changeNationality(event.target.value)}>
                  {NATIONALITIES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <p className="profile-hint">Used to show the travel requirements that apply to you.</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
