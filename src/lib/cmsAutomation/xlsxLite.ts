import { inflateRawSync } from "zlib";

// CMS "엑셀받기"로 내려오는 단순 표 형태의 .xlsx(시트 1개)에서 셀 문자열만 꺼내는 최소 파서입니다.
// 별도 패키지(xlsx/exceljs)를 추가하면 package.json·락파일까지 같이 배포해야 하고 번들 크기도
// 커져서, Node 내장 zlib만으로 필요한 만큼(zip 중앙 디렉터리 → sheet1.xml/sharedStrings.xml → 셀)만
// 읽도록 만들었습니다. 2026-10-05 브래덴코·영커피 CMS의 /api/settlements/sales/download 응답으로
// 구조를 직접 확인했습니다(시트 1개, 문자열은 sharedStrings 또는 inlineStr, 숫자는 "8.201238E7"
// 같은 지수 표기가 섞여 옴).

interface ZipEntry {
  method: number;
  data: Buffer;
}

function readZipEntries(buf: Buffer): Map<string, ZipEntry> {
  // End Of Central Directory(0x06054b50)를 뒤에서부터 찾습니다.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("xlsx 파일 형식이 올바르지 않습니다(zip 구조 없음).");

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map<string, ZipEntry>();

  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("xlsx 중앙 디렉터리가 손상됐습니다.");
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    entries.set(name, { method, data: buf.subarray(dataStart, dataStart + compressedSize) });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readEntryText(entries: Map<string, ZipEntry>, name: string): string | null {
  const e = entries.get(name);
  if (!e) return null;
  if (e.method === 0) return e.data.toString("utf8");
  if (e.method === 8) return inflateRawSync(e.data).toString("utf8");
  throw new Error(`지원하지 않는 xlsx 압축 방식입니다(${e.method}).`);
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

// <si><t>..</t></si> 또는 서식 있는 <si><r><t>..</t></r><r><t>..</t></r></si> 모두 처리.
function parseSharedStrings(xml: string | null): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const parts: string[] = [];
    const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let t: RegExpExecArray | null;
    while ((t = tRe.exec(m[1]))) parts.push(decodeXml(t[1]));
    out.push(parts.join(""));
  }
  return out;
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** 첫 번째 시트를 행 단위 문자열 배열로 반환합니다(빈 셀은 빈 문자열). */
export function parseFirstSheetRows(buf: Buffer): string[][] {
  const entries = readZipEntries(buf);
  const sheetXml = readEntryText(entries, "xl/worksheets/sheet1.xml");
  if (!sheetXml) throw new Error("xlsx에서 첫 번째 시트(sheet1.xml)를 찾지 못했습니다.");
  const shared = parseSharedStrings(readEntryText(entries, "xl/sharedStrings.xml"));

  const rows: string[][] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rm: RegExpExecArray | null;
  while ((rm = rowRe.exec(sheetXml))) {
    const row: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+[0-9]+)"/.exec(attrs)?.[1];
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1];
      const idx = ref ? colIndex(ref) : row.length;

      let value = "";
      if (type === "inlineStr") {
        const parts: string[] = [];
        const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let t: RegExpExecArray | null;
        while ((t = tRe.exec(inner))) parts.push(decodeXml(t[1]));
        value = parts.join("");
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        if (v !== undefined) value = type === "s" ? shared[Number(v)] ?? "" : decodeXml(v);
      }
      while (row.length < idx) row.push("");
      row[idx] = value;
    }
    rows.push(row);
  }
  return rows;
}

