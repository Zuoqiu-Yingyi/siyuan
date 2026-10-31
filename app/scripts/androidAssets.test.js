const {test} = require("node:test");
const assert = require("node:assert/strict");
const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function fixture(t) {
    const root = mkdtempSync(path.join(os.tmpdir(), "siyuan-android-assets-test-"));
    t.after(() => {
        assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
        rmSync(root, {recursive: true, force: true});
    });
    const write = (name, content = "") => {
        const file = path.join(root, name);
        mkdirSync(path.dirname(file), {recursive: true});
        writeFileSync(file, content);
    };
    write("build/mobile/index.html", '<script src="startup.12345678.js"></script><script src="main.12345678.js"></script><link href="base.12345678.css">');
    write("build/mobile/startup.12345678.js");
    write("build/mobile/main.12345678.js", '"chunk.12345678.js"');
    write("build/mobile/chunk.12345678.js");
    write("build/mobile/base.12345678.css");
    write("build/desktop/index.html", '<script src="main.abcdef12.js"></script>');
    write("build/desktop/main.abcdef12.js");
    write("build/export/protyle-method.js");
    write("build/export/base.css");
    return {root, write};
}

test("Android assets retain serving, export and shared resources without historical or Electron bundles", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root, write} = fixture(t);
    write("build/app/main.12345678.js");
    write("build/desktop/main.87654321.js");
    write("build/mobile/startup.87654321.js");
    write("build/mobile/main.12345678.js.map");
    write("protyle/js/editor.js");
    write("icon.png");
    assert.deepEqual(androidStageFiles(root), [
        "stage/build/desktop/index.html",
        "stage/build/desktop/main.abcdef12.js",
        "stage/build/export/base.css",
        "stage/build/export/protyle-method.js",
        "stage/build/mobile/base.12345678.css",
        "stage/build/mobile/chunk.12345678.js",
        "stage/build/mobile/index.html",
        "stage/build/mobile/main.12345678.js",
        "stage/build/mobile/startup.12345678.js",
        "stage/icon.png",
        "stage/protyle/js/editor.js",
    ]);
});

test("Android packaging rejects missing current bundles and serving/export entry points", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root} = fixture(t);
    for (const name of ["build/mobile/main.12345678.js", "build/desktop/index.html", "build/export/base.css"]) {
        const file = path.join(root, name);
        const content = require("node:fs").readFileSync(file);
        rmSync(file);
        assert.throws(() => androidStageFiles(root), /Missing Android resource/);
        writeFileSync(file, content);
    }
});

test("Android assets follow Webpack runtime chunk maps recursively without including old chunks", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root, write} = fixture(t);
    write("build/mobile/main.12345678.js", 'r.u=id=>""+id+"."+{412:"dfe0ef8620230f31a144"}[id]+".js";');
    write("build/mobile/412.dfe0ef8620230f31a144.js", 'r.u=id=>id+"."+{"531":"6a0aa49dc30267337013"}[id]+".js";r.miniCssF=id=>id+"."+{531:"abcdef1234567890"}[id]+".css";');
    write("build/mobile/531.6a0aa49dc30267337013.js");
    write("build/mobile/531.abcdef1234567890.css");
    write("build/mobile/412.87654321.js");
    const mobile = androidStageFiles(root).filter(name => name.startsWith("stage/build/mobile/"));
    assert.deepEqual(mobile, [
        "stage/build/mobile/412.dfe0ef8620230f31a144.js",
        "stage/build/mobile/531.6a0aa49dc30267337013.js",
        "stage/build/mobile/531.abcdef1234567890.css",
        "stage/build/mobile/base.12345678.css",
        "stage/build/mobile/index.html",
        "stage/build/mobile/main.12345678.js",
        "stage/build/mobile/startup.12345678.js",
    ]);
});

test("Android packaging rejects missing resources referenced through Webpack runtime maps", async t => {
    const {androidStageFiles} = await import("../../scripts/android-assets.mjs");
    const {root, write} = fixture(t);
    for (const extension of ["js", "css"]) {
        write("build/mobile/main.12345678.js", `r.u=id=>id+"."+{412:"dfe0ef8620230f31a144"}[id]+".${extension}";`);
        assert.throws(() => androidStageFiles(root), new RegExp(`Missing Android resource: .*412\\.dfe0ef8620230f31a144\\.${extension}`));
    }
});
