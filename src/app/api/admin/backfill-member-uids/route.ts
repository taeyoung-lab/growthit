import { NextRequest, NextResponse } from "next/server";
import { getAdminDb } from "@/lib/firebase/admin";
import { requireSuperAdmin, ApiAuthError } from "@/lib/adminAuthCheck";

// 2026-10-15: 보안 규칙을 member_uids 기반(LIST 안전)으로 바꾼 뒤, 규칙 변경 이전에 만든
// 회의록/과제/질의/결정/회의연결 문서에는 member_uids가 비어 있어 직원 계정(비관리자)에게
// 보이지 않을 수 있습니다. 이 API는 meetings/{id}/permissions 서브컬렉션을 기준으로
// member_uids를 채웁니다. (기존 member_uids에 있던 사람은 지우지 않고 합칩니다 = 합집합)
//
// POST { apply: false } → 점검만(아무것도 쓰지 않음), POST { apply: true } → 실제 반영.
// updated_at 은 건드리지 않습니다(대시보드의 "지난 방문 이후 업데이트" 건수가 부풀지 않도록).
export async function POST(req: NextRequest) {
  try {
    const { profile: adminProfile } = await requireSuperAdmin(req);
    const body = (await req.json().catch(() => ({}))) as { apply?: boolean };
    const apply = body.apply === true;
    const db = getAdminDb();

    const meetingsSnap = await db
      .collection("meetings")
      .where("organization_id", "==", adminProfile.organization_id)
      .get();

    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

    const writes: Array<{ ref: FirebaseFirestore.DocumentReference; uids: string[] }> = [];
    const perMeeting: Array<{ id: string; title: string; before: number; after: number; childDocs: number }> = [];

    for (const m of meetingsSnap.docs) {
      const permSnap = await m.ref.collection("permissions").get();
      const current: string[] = (m.data().member_uids as string[] | undefined) ?? [];
      const target = Array.from(new Set([...permSnap.docs.map((p) => p.id), ...current]));

      let meetingChanged = false;
      if (!sameSet(current, target)) {
        writes.push({ ref: m.ref, uids: target });
        meetingChanged = true;
      }

      let childDocs = 0;
      const childQueries = [
        db.collection("actionItems").where("meeting_id", "==", m.id).get(),
        db.collection("questions").where("meeting_id", "==", m.id).get(),
        db.collection("decisions").where("meeting_id", "==", m.id).get(),
        db.collection("meetingRelations").where("child_meeting_id", "==", m.id).get(),
      ];
      for (const snap of await Promise.all(childQueries)) {
        for (const d of snap.docs) {
          const cur: string[] = (d.data().member_uids as string[] | undefined) ?? [];
          if (!sameSet(cur, target)) {
            writes.push({ ref: d.ref, uids: target });
            childDocs += 1;
          }
        }
      }

      if (meetingChanged || childDocs > 0) {
        perMeeting.push({
          id: m.id,
          title: String(m.data().meeting_title ?? ""),
          before: current.length,
          after: target.length,
          childDocs,
        });
      }
    }

    if (apply) {
      for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch();
        for (const w of writes.slice(i, i + 400)) batch.update(w.ref, { member_uids: w.uids });
        await batch.commit();
      }
    }

    return NextResponse.json({
      ok: true,
      applied: apply,
      meetingsScanned: meetingsSnap.size,
      docsToUpdate: writes.length,
      meetingsAffected: perMeeting,
    });
  } catch (e) {
    if (e instanceof ApiAuthError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error(e);
    return NextResponse.json({ error: "member_uids 보정에 실패했습니다." }, { status: 500 });
  }
}
