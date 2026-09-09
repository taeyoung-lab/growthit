import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";

// 공유 링크 접속 로그 조회 — 슈퍼 관리자 전용.
// Firestore 보안규칙에서는 meetingShareAccessLogs를 아무도 직접 읽을 수 없게 막아두고
// (allow read, write: if false), 대신 이 서버 API에서만 requireSuperAdmin으로 확인한 뒤
// Admin SDK로 조회해 내려줍니다.
export async function GET(req: NextRequest) {
  try {
    const { profile } = await requireSuperAdmin(req);
    const db = getAdminDb();

    const snap = await db.collection("meetingShareAccessLogs").orderBy("accessed_at", "desc").limit(200).get();
    const logs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    // 회의 제목 + 소속 회사 조회 (같은 회의를 여러 로그가 참조할 수 있으므로 캐시)
    const meetingCache = new Map<string, { title: string; organization_id: string } | null>();
    async function getMeetingInfo(meetingId: string | null) {
      if (!meetingId) return null;
      if (meetingCache.has(meetingId)) return meetingCache.get(meetingId)!;
      const mSnap = await db.collection("meetings").doc(meetingId).get();
      const info = mSnap.exists
        ? { title: mSnap.data()?.meeting_title as string, organization_id: mSnap.data()?.organization_id as string }
        : null;
      meetingCache.set(meetingId, info);
      return info;
    }

    const enriched = await Promise.all(
      logs.map(async (log: any) => {
        const meetingInfo = await getMeetingInfo(log.meeting_id);
        return {
          id: log.id,
          accessed_at: log.accessed_at,
          email: log.email,
          access_result: log.access_result,
          ip_address: log.ip_address,
          meeting_title: meetingInfo?.title || null,
          organization_id: meetingInfo?.organization_id || null,
        };
      })
    );

    // 같은 회사(조직) 소속 회의에 대한 로그만 보여줍니다. 어느 회의인지 특정이 안 되는
    // 로그(예: 아예 존재하지 않는 토큰으로 접속 시도)는 조직 구분이 불가능하므로 함께 보여줍니다.
    const visible = enriched.filter((l) => l.organization_id === null || l.organization_id === profile.organization_id);

    return NextResponse.json({ logs: visible });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "공유 접속 로그 조회에 실패했습니다." }, { status: 500 });
  }
}

