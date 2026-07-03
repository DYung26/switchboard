import { defineManifest } from "@crxjs/vite-plugin";
import packageJson from "./package.json";

const { version } = packageJson;

export default defineManifest({
  manifest_version: 3,
  name: "Switchboard",
  description:
    "Switch between multiple accounts on websites that don't natively support it.",
  version,
  icons: {
    16: "src/assets/icons/icon-16.png",
    48: "src/assets/icons/icon-48.png",
    128: "src/assets/icons/icon-128.png",
  },
  action: {
    default_popup: "src/popup/index.html",
    default_icon: {
      16: "src/assets/icons/icon-16.png",
      48: "src/assets/icons/icon-48.png",
      128: "src/assets/icons/icon-128.png",
    },
  },
  options_page: "src/options/index.html",
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  content_scripts: [
    {
      matches: ["<all_urls>"],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
    },
  ],
  permissions: ["storage", "cookies", "scripting"],
  host_permissions: ["<all_urls>"],
});
