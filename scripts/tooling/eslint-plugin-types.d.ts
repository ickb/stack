declare namespace EslintPluginTypes {
  type RuleSeverity = "off" | "warn" | "error" | 0 | 1 | 2;
  type RuleEntry = RuleSeverity | [RuleSeverity, ...unknown[]];
  interface ConfigObject {
    rules?: Record<string, RuleEntry>;
    [key: string]: unknown;
  }
  type ConfigInput = ConfigObject | ConfigInput[];
  interface PluginWithConfigs {
    configs: Record<string, ConfigInput>;
  }
}

declare module "eslint-plugin-promise" {
  const plugin: EslintPluginTypes.PluginWithConfigs;
  export default plugin;
}

declare module "eslint-plugin-security" {
  const plugin: EslintPluginTypes.PluginWithConfigs;
  export default plugin;
}
