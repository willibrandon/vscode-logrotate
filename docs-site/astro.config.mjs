import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import starlight from "@astrojs/starlight";
import logrotateGrammar from "../syntaxes/logrotate.tmLanguage.json" with { type: "json" };

const logrotateLanguage = {
  ...logrotateGrammar,
  name: "logrotate",
};

export default defineConfig({
  site: "https://willibrandon.github.io",
  base: "/vscode-logrotate",
  trailingSlash: "always",
  integrations: [
    starlight({
      title: "Logrotate",
      description: "Language support for logrotate in Visual Studio Code.",
      favicon: "/favicon.svg",
      customCss: ["./src/styles/docs.css"],
      credits: false,
      components: {
        MarkdownContent: "./src/components/MarkdownContent.astro",
      },
      expressiveCode: {
        shiki: {
          langs: [logrotateLanguage],
        },
      },
      social: [
        {
          icon: "github",
          label: "GitHub",
          href: "https://github.com/willibrandon/vscode-logrotate",
        },
      ],
      sidebar: [
        { slug: "" },
        { slug: "getting-started" },
        { slug: "recognized-files" },
        { slug: "editing" },
        { slug: "validation" },
        { slug: "settings" },
        { slug: "commands" },
        { slug: "privacy-and-trust" },
        { slug: "troubleshooting" },
      ],
    }),
    sitemap(),
  ],
});
