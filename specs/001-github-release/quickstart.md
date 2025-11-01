# 快速开始：GitHub发布流程

本指南介绍如何使用GitHub Actions自动构建和发布AI Ask的多平台安装包。

## 前置要求

1. **Git标签权限**: 需要仓库push标签的权限
2. **GitHub Secrets配置**: 移动平台需要配置签名密钥（iOS/Android）
3. **版本号同步**: 确保`package.json`和`src-tauri/tauri.conf.json`版本一致

## 发布流程

### 1. 准备发布

#### 1.1 更新版本号

同步更新三个文件的版本号：

```bash
# 使用npm version命令自动更新package.json
pnpm version patch  # 修复版本 1.0.0 -> 1.0.1
pnpm version minor  # 小版本 1.0.0 -> 1.1.0
pnpm version major  # 大版本 1.0.0 -> 2.0.0
```

手动更新`src-tauri/tauri.conf.json`:

```json
{
  "version": "1.0.1"
}
```

手动更新`src-tauri/Cargo.toml`:

```toml
[package]
version = "1.0.1"
```

#### 1.2 确保Commits符合规范

使用[Conventional Commits](https://www.conventionalcommits.org/)格式：

```bash
feat: 添加新功能
fix: 修复bug
docs: 文档更新
style: 代码格式调整
refactor: 代码重构
test: 测试相关
chore: 构建/工具链相关

# 示例
git commit -m "feat: 添加深色模式支持"
git commit -m "fix: 修复窗口拖动区域问题"
git commit -m "feat!: 重构状态管理（breaking change）"
```

### 2. 创建并推送标签

```bash
# 创建标签（必须以v开头，遵循语义化版本）
git tag v1.0.1

# 推送标签到远程仓库（触发构建）
git push origin v1.0.1

# 或推送所有标签
git push --tags
```

### 3. 监控构建进度

1. 访问GitHub仓库的**Actions**标签页
2. 找到最新触发的**Release**工作流
3. 点击查看详细构建日志

**构建阶段**:
- ✅ Validate Version: 验证版本号格式和一致性
- ✅ Build Desktop: 构建Windows、macOS、Linux平台
- ✅ Build Mobile (可选): 构建Android、iOS平台
- ✅ Generate Changelog: 生成版本更新说明
- ✅ Create Release: 创建GitHub Release并上传文件

### 4. 验证发布

构建完成后：

1. 访问GitHub仓库的**Releases**页面
2. 找到刚创建的版本（如v1.0.1）
3. 验证内容：
   - ✅ Release Notes包含完整的changelog
   - ✅ 所有平台的安装包都已上传
   - ✅ 文件名格式正确（如`AI-Ask_1.0.1_x64.msi`）

4. 下载并测试安装包：
   ```bash
   # Windows: 双击MSI或NSIS安装
   # macOS: 双击DMG，拖拽到Applications
   # Linux: 
   sudo dpkg -i ai-ask_1.0.1_amd64.deb  # Debian/Ubuntu
   # 或使用AppImage（无需安装）
   chmod +x AI-Ask_1.0.1_x86_64.AppImage
   ./AI-Ask_1.0.1_x86_64.AppImage
   ```

## 版本验证（推送前检查）

在推送标签前，可以本地验证版本号一致性：

```bash
# 验证版本号格式和一致性
pnpm release:validate

# 手动测试本地构建（可选，非发布流程必需）
pnpm tauri build
```

**注意**: 所有正式构建都在GitHub Actions中自动执行，本地构建仅用于开发调试。

## 手动触发构建

如果不想通过标签触发，可以手动运行工作流：

1. 访问**Actions** → **Release**工作流
2. 点击**Run workflow**按钮
3. 选择分支（通常是main）
4. 输入版本号（如1.0.1，不需要v前缀）
5. 点击**Run workflow**开始构建

## 故障排查

### 构建失败

**检查清单**:

1. 版本号格式是否正确？（v1.0.0，语义化版本）
2. package.json和tauri.conf.json版本是否一致？
3. 依赖是否完整？（pnpm install执行过）
4. Rust工具链是否正确？（cargo版本）
5. 特定平台失败查看详细日志

**常见错误**:

| 错误 | 原因 | 解决方案 |
|------|------|----------|
| Version mismatch | 版本号不一致 | 同步更新所有文件版本 |
| Build timeout | 构建超时 | 优化缓存或增加超时限制 |
| Missing dependencies | 依赖缺失 | 检查package.json和Cargo.toml |
| Signing failed (iOS/Android) | 签名配置错误 | 检查GitHub Secrets配置 |

### 部分平台失败

工作流配置为`continue-on-error: true`，单个平台失败不影响其他平台：

1. 检查失败平台的构建日志
2. 修复问题后重新推送标签（删除旧标签）：
   ```bash
   # 删除本地和远程标签
   git tag -d v1.0.1
   git push origin :refs/tags/v1.0.1
   
   # 修复问题后重新创建
   git tag v1.0.1
   git push origin v1.0.1
   ```

### Changelog缺失或不完整

**原因**: Commits不符合conventional commits格式

**解决方案**:
1. 确保commits使用规范格式（feat:, fix:, etc.）
2. 如已推送非规范commits，手动编辑Release Notes补充

## 高级配置

### 配置移动平台签名

#### Android签名

1. 生成keystore:
   ```bash
   keytool -genkey -v -keystore ai-ask.keystore \
     -alias ai-ask -keyalg RSA -keysize 2048 -validity 10000
   ```

2. 配置GitHub Secrets:
   - `ANDROID_KEYSTORE`: Base64编码的keystore文件
   - `ANDROID_KEYSTORE_PASSWORD`: keystore密码
   - `ANDROID_KEY_ALIAS`: 密钥别名
   - `ANDROID_KEY_PASSWORD`: 密钥密码

#### iOS签名

1. 导出证书和provisioning profile（.p12和.mobileprovision）

2. 配置GitHub Secrets:
   - `IOS_CERTIFICATE_P12`: Base64编码的证书文件
   - `IOS_CERTIFICATE_PASSWORD`: 证书密码
   - `IOS_PROVISIONING_PROFILE`: Base64编码的profile文件

**Base64编码命令**:
```bash
base64 -i ai-ask.keystore -o keystore.base64  # macOS/Linux
certutil -encode ai-ask.keystore keystore.base64  # Windows
```

### 自定义构建参数

编辑`.github/workflows/build-desktop.yml`修改构建矩阵：

```yaml
strategy:
  matrix:
    include:
      # 添加新平台
      - os: ubuntu-latest
        target: aarch64-unknown-linux-gnu
        artifact: linux-arm64
```

## 最佳实践

1. **语义化版本**: 严格遵循MAJOR.MINOR.PATCH规则
2. **规范Commits**: 使用commitlint工具强制规范
3. **测试后发布**: 本地测试通过再推送标签
4. **版本同步**: 使用脚本自动同步版本号
5. **Release Notes**: 补充手动编写的重要说明
6. **备份密钥**: 妥善保管签名证书和密钥

## 相关资源

- [Tauri构建指南](https://tauri.app/v1/guides/building/)
- [GitHub Actions文档](https://docs.github.com/en/actions)
- [Conventional Commits](https://www.conventionalcommits.org/)
- [语义化版本](https://semver.org/lang/zh-CN/)
