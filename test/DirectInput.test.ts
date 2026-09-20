import * as it from "@effect/vitest"

import * as DirectInput from "../src/DirectInput.js"

it.describe("DirectInput", () => {
  it.it("represents stdin text as newly added source at a requested line", () => {
    const diff = DirectInput.fromText("src/User.ts", "const token = secret\nlog(token)\n", 40)
    const file = diff.files[0]!
    const hunk = file.hunks[0]!

    it.expect(diff.base).toBe("stdin")
    it.expect(diff.head).toBe("BUFFER")
    it.expect(file.path).toBe("src/User.ts")
    it.expect(hunk.newStart).toBe(40)
    it.expect(hunk.newLines).toBe(2)
    it.expect(hunk.patch).toContain("@@ -0,0 +40,2 @@")
    it.expect(hunk.patch).toContain("+log(token)")
  })
})
