`packages/assets/` 目录存放 fnOS 打包模板资源。

这些文件不会直接参与源码开发，而是在 `npm run prepare:package` 时被渲染到 `.fnos-build/package/`。

- 包根图标 `ICON.PNG` 为 512 x 512，用于应用中心/应用详情页大图展示
- `ICON_256.PNG` 必须为 256 x 256
- 入口图标使用 `generated/icon_{size}.png`
- 图标矢量源文件为 `icons/logo-source.svg`
- 修改图标后运行 `npm run generate:icons` 重新生成 PNG
- `npm run validate:package` 会检查关键图标尺寸
