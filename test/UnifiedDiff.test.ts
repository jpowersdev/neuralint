import * as it from "@effect/vitest"

import * as UnifiedDiff from "../src/UnifiedDiff.js"

const source = `diff --git a/src/a.ts b/src/a.ts
index 1111111..2222222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,2 +1,3 @@
 export const a = 1
+export const b = 2
 export const c = 3
diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const old = true
`

it.describe("UnifiedDiff", () => {
  it.it("parses files and stable hunk ids", () => {
    const diff = UnifiedDiff.parse(source, "base-sha", "HEAD")

    it.expect(diff.files).toHaveLength(2)
    it.expect(diff.files[0]?.path).toBe("src/a.ts")
    it.expect(diff.files[0]?.hunks[0]?.id).toBe("F001:H001")
    it.expect(diff.files[0]?.hunks[0]?.newLines).toBe(3)
    it.expect(diff.files[1]?.path).toBe("src/old.ts")
    it.expect(diff.files[1]?.newPath).toBe("/dev/null")
  })
})
