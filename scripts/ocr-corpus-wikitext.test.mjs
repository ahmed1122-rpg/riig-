import assert from "node:assert/strict";
import test from "node:test";
import { cleanProofreadWikitext } from "./ocr-corpus-wikitext.mjs";

test("moves Wikisource footnotes after visible body text", () => {
  const source =
    '<noinclude><pagequality level="4" /></noinclude>متن{{حا|هامش أول}} بقية{{حا|هامش ثان}}<noinclude>{{حواشي}}</noinclude>';

  assert.equal(
    cleanProofreadWikitext(source),
    "متن بقية\n\nهامش أول\nهامش ثان",
  );
});

test("moves contentful ref tags after the complete visible body", () => {
  const source = [
    '<noinclude><pagequality level="4" /></noinclude>',
    'بداية<ref name="تفصيل">هامش فيه [[مصر|نص ظاهر]]</ref>',
    " نهاية",
    "<noinclude>{{مراجع مصغرة}}</noinclude>",
  ].join("");

  assert.equal(
    cleanProofreadWikitext(source),
    "بداية نهاية\n\nهامش فيه نص ظاهر",
  );
});

test("keeps reused self-closing references out of visible text", () => {
  assert.equal(
    cleanProofreadWikitext('متن<ref name="تفصيل" /> بقية'),
    "متن بقية",
  );
});

test("does not promote references from non-visible page metadata", () => {
  assert.equal(
    cleanProofreadWikitext(
      "متن<noinclude><ref>بيانات غير مطبوعة</ref></noinclude> بقية",
    ),
    "متن\nبقية",
  );
});

test("preserves poetry reading order without media-link artifacts", () => {
  const source = [
    "{{وسط|{{ع2|عنوان}}}}",
    "{{أبيات|يمين\\\\يسار}}",
    "[[ملف:رسم.png|250بك|لاإطار|مركز]]",
  ].join("\n");

  assert.equal(cleanProofreadWikitext(source), "عنوان\nيمين\nيسار");
});

test("uses only the visible label from Wikisource page links", () => {
  assert.equal(
    cleanProofreadWikitext(
      ":السامانيون {{ربط بصفحة|17|1|١٧}}",
    ),
    ":السامانيون ١٧",
  );
});

test("drops layout helpers while preserving styled visible text", () => {
  const source = [
    "{{سطر|8em|align=right}}",
    "{{يسار|'''أسد رستم'''}}",
    "{{أحمر|باب الإعراب}}",
  ].join("\n");

  assert.equal(
    cleanProofreadWikitext(source),
    "أسد رستم\nباب الإعراب",
  );
});

test("removes named template arguments without dropping visible fields", () => {
  assert.equal(
    cleanProofreadWikitext(
      "{{رص تبديل|12|اسم الفصل|التذكار|تنسيق الرقم=مشرقية}}",
    ),
    "12 اسم الفصل التذكار",
  );
});
