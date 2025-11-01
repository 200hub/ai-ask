# Feature Specification: 快速问答（Quick Ask）

**Feature Branch**: `001-quick-ask`  
**Created**: 2025-11-01  
**Status**: Draft  
**Input**: User description: "我要实现个快速问答功能，无论应用是否在前台显示，比如说只要按两下shift键就出现一个问答框，输入内容之后，直接在问答框下面显示结果。这个功能要尽可能轻量，减少对用户的干扰以及不必要的操作。比如说调起这个问答框的时候如果剪贴板里面有内容就直接贴进去，同时还可以增加语音输入。按一下esc键可以直接退出。

要实现这个功能三个要求：
一是要能往各AI平台的webview页面注入JS脚本。用于自动化的把问答内容传入到webview的问答框中并自动执行发送按钮。
二是要注册这个全局的快捷键。
三是要在配置页面增加一个快速问答所使用的AI平台的启用功能，同一时间只能有一个被启用。快速问答所使用的AI平台就是这个被启用的平台。"

## User Scenarios & Testing *(mandatory)*

<!--
  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
  
  Assign priorities (P1, P2, P3, etc.) to each story, where P1 is the most critical.
  Think of each story as a standalone slice of functionality that can be:
  - Developed independently
  - Tested independently
  - Deployed independently
  - Demonstrated to users independently
-->

### User Story 1 - 双击 Shift 打开轻量问答框（P1）

作为用户，我希望在任何界面按两下 Shift 键即可呼出一个轻量的问答框，尽量不打断当前工作流；如果剪贴板有文本则自动填入输入框，回车发送后问答框消失，并立即切换显示“已启用平台”的 WebView 页面，在平台页面内查看回答；按 ESC 立即退出。

**Why this priority**: 该能力是“快速问答”的核心价值，决定是否能实现“随时随地、低干扰”的快速获取答案。

**Independent Test**: 仅实现热键→弹窗→输入→显示结果→ESC 关闭，即可独立验证价值（无需依赖设置页或语音）。

**Acceptance Scenarios**:

1. Given 应用在后台或最小化，When 用户在任意界面连续按两次 Shift（≤400ms 间隔），Then 300ms 内问答框出现在前台且获得输入焦点。
2. Given 系统剪贴板包含纯文本，When 问答框出现，Then 输入框自动填充剪贴板文本且文本可编辑。
3. Given 用户输入或确认文本，When 按 Enter 发送，Then 问答框立即隐藏并切换到“已启用平台”的 WebView 页面，平台页面内显示生成进度并随后显示完整回答；ESC 任意时刻可在发送前关闭并清空。

---

### User Story 2 - 注入所选平台 WebView 并自动发送（P2）

作为用户，我希望快速问答在发送时，能将问题注入到“已启用”的 AI 平台 WebView 的输入框并自动点击发送，以便复用平台账户与上下文。

**Why this priority**: 复用各平台现有对话能力与上下文，降低实现成本并提升回答质量。

**Independent Test**: 在至少一个受支持平台上，完成“打开→注入文本→自动发送→平台内产生新回复”的全链路验证。

**Acceptance Scenarios**:

1. Given 配置页仅启用一个平台，When 用户在问答框按 Enter，Then 该平台对应的 WebView 收到文本并自动触发发送按钮。
2. Given 平台页面需要登录，When 未登录，Then 显示可理解的提示并引导用户先完成登录，再次重试。

---

### User Story 3 - 配置“快速问答使用的平台”（单选）（P3）

作为用户，我希望在设置中为“快速问答”选择唯一启用的平台，明确当前使用哪个平台进行提问。

**Why this priority**: 明确系统行为、避免多平台并发带来的混乱和资源占用。

**Independent Test**: 仅通过设置页的单选切换，即可独立验证“唯一启用”的约束与生效范围。

**Acceptance Scenarios**:

1. Given 多个平台可供选择，When 用户勾选某一平台为“快速问答平台”，Then 其他平台自动取消启用且状态持久化。
2. Given 已选择平台 A，When 用户再次选择平台 B，Then 平台 A 失效、平台 B 生效，快速问答随即改用平台 B。

---

### User Story 4 - 语音输入（可选）（P4）

作为用户，我希望在问答框中一键开启/关闭语音输入，将语音转文本后回填到输入框，由我确认后再发送，进一步减少键盘输入。

**Why this priority**: 提升输入效率，便于无手操作或多任务场景。

**Independent Test**: 在不影响 US1 的前提下，验证语音开始/结束/转写/回填/发送的闭环。

**Acceptance Scenarios**:

1. Given 麦克风权限已授予，When 用户点击“语音输入”按钮并开始说话，Then 输入框出现实时或结束后的转写文本，用户可编辑并发送。
2. Given 用户点击结束或静音超时，When 识别完成，Then 文本回填到输入框等待用户确认（默认手动确认，不自动发送）。

---

[Add more user stories as needed, each with an assigned priority]

### Edge Cases

- 剪贴板为空/非常长/包含二进制或富文本：仅提取纯文本并限制最大长度（例如 8k 字符），超出提示缩略。
- 快捷键冲突或 OS 禁止键盘钩子：提供备用热键或给出指引；记录失败日志。
- 用户在其它应用中本就频繁连按 Shift：误触发概率需可控；提供开关和时间窗调节。
- WebView 未加载完成/平台未登录/CSP 限制脚本注入：给出可理解提示并允许重试或跳转登录。
- 网络离线/平台报错/超时：在问答框结果区域展示错误状态与重试入口。
- 语音权限拒绝/无麦克风设备/识别失败：提示并回退到文本输入。
- 并发发送：新请求取消旧请求或并行展示，避免 UI 混乱。

## Requirements *(mandatory)*

<!--
  ACTION REQUIRED: The content in this section represents placeholders.
  Fill them out with the right functional requirements.
-->

### Functional Requirements

- **FR-001 热键触发**：系统必须注册“连续两次 Shift”作为全局快捷键（默认两次按压间隔阈值 400ms，可在设置中调整），无论应用是否前台均可唤起问答框。
- **FR-002 弹窗性能**：问答框在接收到热键后 300ms 内显示到最前并获取输入焦点。
- **FR-003 剪贴板预填**：当剪贴板存在纯文本时，问答框出现时自动填入输入框，用户可编辑后发送。
- **FR-004 发送与显示**：按 Enter 发送后，问答框立即隐藏并切换到“已启用平台”的 WebView 页面；平台内展示生成进度与回答；ESC 在发送前任意时刻可立即关闭并清空临时状态。
- **FR-005 平台唯一启用**：设置页提供“快速问答平台”单选开关，同时仅允许一个平台处于启用状态；启用状态持久化并立即生效。
- **FR-006 WebView 注入**：系统必须能向“启用的平台”的 WebView 注入脚本，将文本填入平台输入框并自动触发发送按钮。
- **FR-007 登录与失败处理**：当目标平台需要登录或页面结构不匹配时，需给出清晰提示与重试/跳转能力，不阻塞主 UI。
- **FR-008 权限与安全**：语音/剪贴板/热键等权限请求需符合平台规范，拒绝时提供替代路径；注入脚本仅对受支持站点生效。
- **FR-009 语音输入（可选）**：问答框提供语音输入的开启/结束控制，识别文本回填到输入框；识别失败需可回退到纯文本输入。
- **FR-010 答案呈现位置**：按 Enter 发送后隐藏问答框，并切换显示“已启用平台”的 WebView 页面；用户在平台页面内观看回答。
- **FR-011 支持范围（分阶段）**：MVP 仅对“官方受支持清单”内的平台提供稳定注入与自动发送支持；后续按版本逐步扩展清单，并在文档中持续更新受支持平台列表与变更说明。

### Key Entities *(include if feature involves data)*

- **QuickAskConfig**：表示快速问答相关配置（已启用平台标识、热键时间窗、是否启用语音输入、最近一次选择等）。
- **Platform (existing)**：可选用的 AI 平台条目（名称、标识、站点 URL、是否可注入、登录状态等）。

## Assumptions & Dependencies

- 假设双击 Shift 判定默认阈值为 400ms，用户可在设置中调整。
- 假设至少存在一个受支持的平台，并且用户已对该平台完成登录以便可注入与发送。
- 假设操作系统允许注册全局快捷键与麦克风权限授予；权限被拒绝时提供替代路径。
- 假设无需引入历史记录/草稿持久化（本版本聚焦“即取即用”）。

## Success Criteria *(mandatory)*

<!--
  ACTION REQUIRED: Define measurable success criteria.
  These must be technology-agnostic and measurable.
-->

### Measurable Outcomes

- **SC-001 可达性**：≥95% 的情况下，双击 Shift 到问答框可见的用时 ≤300ms。
- **SC-002 便捷性**：当剪贴板含文本时，≥99% 的情况下自动预填成功且可编辑。
- **SC-003 注入成功率**：对“受支持清单”内的平台，自动注入并触发发送的成功率 ≥95%。
- **SC-004 任务完成效率**：用户从唤起到获得首个可读答案的中位用时 ≤10 秒（网络正常、平台可用前提）。
- **SC-005 无干扰关闭**：按下 ESC 到问答框完全消失的用时 ≤100ms。
- **SC-006 单一平台约束**：任一时刻仅存在一个启用的平台；切换后新请求必定落到最新启用的平台（抽样验证通过率 ≥99%）。
