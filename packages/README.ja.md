# Capability パッケージ接続ガイド

[English](README.md) | [简体中文](README.zh-CN.md) | [日本語](README.ja.md)

パッケージの開発では、相対インポートに実際のソースファイル名（`./types.ts` や
`./react.tsx`）を指定してください。共通の TypeScript 設定では
`rewriteRelativeImportExtensions` が有効なため、公開用コンパイル時に `./types.js`
などの JavaScript パスへ変換されます。Turbopack と Webpack は拡張子エイリアスなしで
同じソースを利用できます。利用側は引き続き公開済みの `@webpilot/*` エントリーからインポートします。

必要な能力の README から始めます。各パッケージは英語・簡体字中国語・日本語の接続ガイドを提供し、例のファイルは利用側プロジェクトに作ります。通常の能力は SDK 契約を共有し、host がマウント、AI SDK/MCP は任意の変換です。sensitive-data は最終モデル呼び出しをラップします。

| パッケージ | 用途 |
| --- | --- |
| [capability-adapter-ai-sdk](capability-adapter-ai-sdk/README.ja.md) | Capability Provider を AI SDK 7 のツールと Agent 指示に変換します。 |
| [capability-adapter-mcp](capability-adapter-mcp/README.ja.md) | 利用する Agent フレームワークから独立して、MCP 経由で Provider を公開します。 |
| [capability-browser](capability-browser/README.ja.md) | 永続的な JavaScript 環境とページ観測を通じて Playwright ブラウザーを操作します。 |
| [capability-chart](capability-chart/README.ja.md) | ECharts/Three.js のチャートレコードを生成・保存・編集し、必要に応じて React で描画します。 |
| [capability-code-sandbox](capability-code-sandbox/README.ja.md) | 交換可能な実行器で制限付き JavaScript/Python 計算を実行します。 |
| [capability-communication](capability-communication/README.ja.md) | メッセージ下書きを作成し、設定済みチャネルで送信して配信結果を記録します。 |
| [capability-computer](capability-computer/README.ja.md) | ローカルまたはリモートのドライバーで対話型デスクトップを観測・操作します。 |
| [capability-connectors](capability-connectors/README.ja.md) | 外部 MCP、OpenAPI、独自の操作を検出して呼び出します。 |
| [capability-data](capability-data/README.ja.md) | 注入したドライバーで SQL データソースを検出し、制限付きクエリを実行します。 |
| [capability-file](capability-file/README.ja.md) | ファイルの読み取りと公開、Office 文書の生成・編集、成果物ワークスペースの管理を行います。 |
| [capability-git](capability-git/README.ja.md) | ホストが選んだ Git リポジトリを調査し、明示的に変更します。 |
| [capability-host](capability-host/README.ja.md) | 正規化された設定、ツール選択、移植可能な Skill カタログとともに Provider をマウントします。 |
| [capability-knowledge](capability-knowledge/README.ja.md) | 参照文書を永続化し、索引付きテキストを検索します。 |
| [capability-media](capability-media/README.ja.md) | メディアの調査、フレーム抽出、ホストが選んだ OCR・文字起こし・生成エンジンへの接続を行います。 |
| [capability-sdk](capability-sdk/README.ja.md) | 移植可能な Capability 契約と共通の実行・ライフサイクル機構を定義します。 |
| [capability-workflow](capability-workflow/README.ja.md) | 依存関係を持つワークフローと確認済みチェックポイントを永続化します。 |
| [capability-sensitive-data](capability-sensitive-data/README.ja.md) | 最終モデル境界の秘匿化ミドルウェア |

## 接続方法を選ぶ

1. 独自 TypeScript Agent：具体 Provider → host.mountCapabilities → ネイティブツール/スキーマ変換 → Agent Loop。[完全な共通ガイド](capability-sdk/FRAMEWORK_INTEGRATION.ja.md) は Provider、解析、実行ポリシー、Skill、最初の呼び出し、モデル駆動 Agent を含みます。
2. AI SDK 7：capability-adapter-ai-sdk の mountAISDKCapabilities を使います。
3. MCP：[サーバー/クライアントガイド](capability-adapter-mcp/MCP.ja.md) で複数 Provider を公開できます。stdio とステートフル HTTP 待ち受けがあり、リモート利用者はクライアント依存だけを導入します。
4. 直接操作：公開された下位 API で設定と寿命を自分で管理します。SDK は能力の依存ですが、直接 import するなら直接依存にします。
5. 機密データ：MCP 結果を含む完全なプロンプトの組立後、毎モデル呼び出しの直前にフィルターを通します。

## 配布と保守

各ディレクトリは独立した版の npm パッケージです。例は現在の 0.1.0 契約に対応し、一致する公開版を使います。README*.md、MCP*.md、SDK の FRAMEWORK_INTEGRATION*.md を files に同梱します。ソース開発では npm workspaces とルート TypeScript paths でローカル包を使います。中立なコアは Orbit コードを読み込まず、専用変換は明示入口です。

manifest は設定と Skill を持ち、能力が所有します。Agent ホストはツール公開、Skill 事前読込、操作承認、保存先の識別、モデルループを担当します。フレームワーク変更は変換層だけに留めます。公開契約や例の変更時は三言語を更新し、コード識別子と設定キーを維持します。各 README は直接接続に必要な情報を持ち MCP ガイドも同梱し、兄弟パッケージのリンクは任意の追加資料です。
