import type { StorybookConfig } from "@storybook/nextjs-vite";

const config: StorybookConfig = {
  // Colocated with the components, the same place *.test.tsx lives.
  stories: ["../components/**/*.stories.tsx"],
  addons: [
    // Visual-test addon: surfaces Chromatic changes in the Storybook UI.
    "@chromatic-com/storybook",
  ],
  framework: "@storybook/nextjs-vite",
  // No staticDirs — there is no web/public directory in this repo.
};

export default config;
