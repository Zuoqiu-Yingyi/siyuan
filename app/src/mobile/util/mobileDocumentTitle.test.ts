import * as assert from "node:assert/strict";
import {execFile} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {resolve} from "node:path";
import {test} from "node:test";
import {promisify} from "node:util";
import {compile} from "sass";
import {ModuleKind, ScriptTarget, transpileModule} from "typescript";

const browserCases = (sources: Record<string, string>) => {
    const check: typeof assert = require("node:assert/strict");
    document.head.innerHTML = `<style>${sources.css}</style>`;
    document.body.style.cssText = "--b3-font-size:16px;--b3-font-size-editor:32px";
    document.body.innerHTML = `<div class="toolbar mobile-topbar"><button class="toolbar__button">L</button>
<input id="toolbarName" class="toolbar__title"><span id="toolbarNameReadonly" class="toolbar__title toolbar__title--readonly"></span>
<button class="toolbar__button">R</button></div><div id="editor"></div>`;
    const input = document.getElementById("toolbarName") as HTMLInputElement;
    const label = document.getElementById("toolbarNameReadonly");
    const protyle = {element: document.getElementById("editor"), block: {rootID: "document"}, notebookId: "box",
        disabled: false, preview: {element: document.createElement("div")}};
    protyle.preview.element.className = "fn__none";
    const runtime = {siyuan: {mobile: {editor: {protyle}}, config: {editor: {autoDirection: false}}}};
    const pending: Array<{id: string, reply: (response: unknown) => void}> = [];
    const modules: Record<string, any> = {
        "../../util/fetch": {fetchPost: (_url: string, data: {id: string}, reply: (response: unknown) => void) =>
            pending.push({id: data.id, reply})},
        "../../util/pathName": {getDocDisplayName: (text: string, empty: boolean) => empty ? "Untitled" : text},
        "../../util/hostCapabilities": {sanitizeKernelHTML: (html: string) => html},
        "../render/mathRender": {mathRender: () => Promise.resolve()},
        "../../protyle/render/autoDirection": {setTitleAutoDirection: () => {}},
    };
    const load = (source: string) => {
        const exports: Record<string, any> = {};
        new Function("exports", "require", "window", source)(exports, (name: string) => modules[name] || {}, runtime);
        return exports;
    };
    modules["../../protyle/header/documentTitlePreview"] = load(sources.preview);
    const {updateMobileDocumentTitle: update} = load(sources.title);
    const {updateMobileTitleReadonly: readonly} = load(sources.readonly);
    const response = (html: string) => ({code: 0, data: {id: protyle.block.rootID, notebook: protyle.notebookId,
        format: "inline-ast", text: "Summary", empty: false,
        blockDOM: `<div data-type="NodeParagraph"><div contenteditable="true">${html}</div></div>`}});
    input.value = "Summary";
    update(protyle);
    readonly(protyle);
    check.equal(input.classList.contains("fn__none"), true);
    check.equal(label.classList.contains("fn__none"), false);
    check.equal(label.tabIndex, 0);
    check.equal(label.textContent, "Summary");
    pending.shift().reply(response('<span data-type="strong">Bold</span> <span data-type="em">Italic</span>' +
        '<span class="img"><img width="100" height="200" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="></span>' +
        '<span data-type="inline-math" data-content="x^2">x²</span>' +
        '<span style="font-size:72px">Large</span> ' + "Long title ".repeat(30)));
    check.ok(label.querySelector('[data-type="strong"]'));
    check.ok(label.querySelector("img"));
    check.ok(label.querySelector('[data-type="inline-math"]'));
    check.equal(input.value, "Summary", "the plain summary stays available to tabs and API callers");
    check.ok(label.getBoundingClientRect().height <= 48, "inline content cannot expand the navigation bar");
    check.ok(label.firstElementChild.getBoundingClientRect().width <= label.getBoundingClientRect().width + 1);
    const richHTML = label.innerHTML;
    for (const mode of ["readonly", "preview", "editing"]) {
        protyle.disabled = mode === "readonly";
        protyle.preview.element.classList.toggle("fn__none", mode !== "preview");
        readonly(protyle);
        check.equal(label.innerHTML, richHTML, "mode switching preserves the rich preview");
        check.equal(label.tabIndex, mode === "editing" ? 0 : -1);
    }
    update(protyle);
    const stale = pending.shift();
    protyle.block.rootID = "next";
    input.value = "Next";
    update(protyle);
    stale.reply({code: 0, data: {id: "document", notebook: "box", format: "plain", text: "Stale secret"}});
    check.equal(label.textContent, "Next");
    label.replaceChildren();
    pending.shift().reply(response("Late locked title"));
    check.equal(label.textContent, "", "clearing the title prevents late plaintext restoration");
    input.value = "";
    update(protyle);
    check.equal(label.textContent, "Untitled");
    protyle.block.rootID = "box";
    input.value = "Notebook / literal **title**";
    update(protyle);
    readonly(protyle);
    check.equal(input.classList.contains("fn__none"), false);
    check.equal(label.classList.contains("fn__none"), true);
    check.equal(input.readOnly, false);
    check.equal(label.textContent, input.value);
    return "Mobile document title cases passed";
};

test("mobile navigation renders rich titles, preserves summaries and clears stale or locked previews", {
    skip: process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY,
    timeout: 30000,
}, async () => {
    const source = (file: string) => transpileModule(readFileSync(resolve(__dirname, file), "utf8"), {
        compilerOptions: {module: ModuleKind.CommonJS, target: ScriptTarget.ES2021},
    }).outputText;
    const sources = {title: source("mobileDocumentTitle.ts"), preview: source("../../protyle/header/documentTitlePreview.ts"),
        readonly: source("../../protyle/util/setEditMode.ts"),
        css: compile(resolve(__dirname, "../../assets/scss/mobile.scss"), {logger: {warn() {}, debug() {}}}).css};
    const directory = mkdtempSync(resolve(tmpdir(), "siyuan-mobile-title-"));
    const script = resolve(directory, "run.cjs");
    const code = "const __name = value => value; (" + browserCases.toString() + ")(" + JSON.stringify(sources) + ")";
    writeFileSync(script, `const {app,BrowserWindow}=require("electron");
app.setPath("userData", ${JSON.stringify(resolve(directory, "profile"))});
app.commandLine.appendSwitch("disable-gpu");
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:390,height:800,webPreferences:{nodeIntegration:true,contextIsolation:false}});
 win.webContents.on("console-message",event=>console.error(event.message));
 try{await win.loadURL("data:text/html,<html><body></body></html>");
 console.log(await win.webContents.executeJavaScript(${JSON.stringify(code)}));win.destroy();app.exit(0);
 }catch(error){console.error(error);win.destroy();app.exit(1);}
});`, "utf8");
    const env = {...process.env};
    delete env.ELECTRON_RUN_AS_NODE;
    try {
        const result = await promisify(execFile)(require("electron") as unknown as string, [script],
            {env, windowsHide: true, timeout: 25000});
        assert.match(result.stdout, /Mobile document title cases passed/);
    } finally {
        if (resolve(directory, "..") === resolve(tmpdir()) && directory.startsWith(resolve(tmpdir(), "siyuan-mobile-title-"))) {
            rmSync(directory, {recursive: true, force: true});
        }
    }
});
