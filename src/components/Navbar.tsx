"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useAuth } from "@/contexts/AuthContext";

const LINKS = [
  { href: "/", label: "메인" },
  { href: "/projects", label: "프로젝트" },
  { href: "/me", label: "내 업무" },
  { href: "/admin", label: "관리자" },
];

export function Navbar() {
  const { profile } = useAuth();
  const pathname = usePathname();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <div className="flex items-center gap-8">
          <span className="font-bold text-navy">회의 지식관리</span>
          <nav className="flex gap-1">
            {LINKS.filter((l) => l.href !== "/admin" || profile?.org_role === "ORG_ADMIN").map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm ${
                  pathname === l.href ? "bg-navy text-white" : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          {profile && <span>{profile.user_name}님</span>}
          <button className="text-gray-400 hover:text-gray-700" onClick={() => signOut(auth)}>
            로그아웃
          </button>
        </div>
      </div>
    </header>
  );
}
