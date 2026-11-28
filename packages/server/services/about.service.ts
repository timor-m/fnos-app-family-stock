import metadata from '../../../package.json' with { type: 'json' };
import template from '../../../template.config.json' with { type: 'json' };
import { getAppConfig } from '../utils/runtime-config';
import { schemaVersion } from '../database/schema';
export function getAboutSummary() {
  const config=getAppConfig();
  return {appName:template.appName,appTitle:template.appTitle,appVersion:metadata.version,appDescription:template.appDescription,maintainer:template.maintainer,sourceUrl:metadata.homepage,osMinVersion:template.osMinVersion,accessMode:config.accessMode,runtime:{node:process.version,platform:process.platform,arch:process.arch},database:{schemaVersion}};
}
export function feedbackEnvironment() {
  const about=getAboutSummary();
  return {app:{version:about.appVersion},deployment:{type:process.env.NODE_ENV!=='production'?'development':process.env.FNOS_SOCKET_PATH?'fnos':'unknown',accessMode:about.accessMode},server:{platform:about.runtime.platform,arch:about.runtime.arch,nodeVersion:about.runtime.node},database:{schemaVersion}};
}
