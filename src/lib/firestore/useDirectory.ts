"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase/client";
import { formatUserDisplayName, type Organization, type Department, type UserProfile } from "@/lib/types";

interface Directory {
  users: Record<string, UserProfile>;
  organizations: Record<string, Organization>;
  departments: Record<string, Department>;
  displayName: (userId: string | null | undefined) => string;
  loading: boolean;
}

/**
 * "회사 - 부서 - 이름" 표기(4.3장)를 위해 같은 회사 사용자/부서/조직 정보를 한 번에 불러옵니다.
 * 공유받은 외부 회의에 다른 회사 참석자가 섞여 있을 수 있어, 조직 목록도 함께 조회합니다.
 */
export function useDirectory(organizationId: string | undefined): Directory {
  const [users, setUsers] = useState<Record<string, UserProfile>>({});
  const [organizations, setOrganizations] = useState<Record<string, Organization>>({});
  const [departments, setDepartments] = useState<Record<string, Department>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;

    async function load() {
      try {
        const usersSnap = await getDocs(query(collection(db, "users"), where("organization_id", "==", organizationId)));
        const deptSnap = await getDocs(
          query(collection(db, "departments"), where("organization_id", "==", organizationId))
        );
        const orgSnap = await getDocs(collection(db, "organizations"));
        if (cancelled) return;

        setUsers(Object.fromEntries(usersSnap.docs.map((d) => [d.id, d.data() as UserProfile])));
        setDepartments(Object.fromEntries(deptSnap.docs.map((d) => [d.id, d.data() as Department])));
        setOrganizations(Object.fromEntries(orgSnap.docs.map((d) => [d.id, d.data() as Organization])));
      } catch (error) {
        // 조회 실패 시에도 로딩 상태가 영원히 true로 남아 화면(담당주체 선택 등)이
        // 빈 채로 멈춰 보이지 않도록 합니다.
        console.error("[useDirectory] 조직 구성원/부서 조회 실패:", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  function displayName(userId: string | null | undefined): string {
    if (!userId) return "-";
    const user = users[userId];
    if (!user) return "(알 수 없는 사용자)";
    return formatUserDisplayName(user, organizations[user.organization_id] ?? null, departments[user.department_id ?? ""] ?? null);
  }

  return { users, organizations, departments, displayName, loading };
}
