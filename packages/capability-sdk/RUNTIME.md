# Automatic runtime setup

React and React DOM are required peer dependencies installed automatically by npm. Frontend consumers share their existing React instance.

Install with `npm install @cjfclonedeep/capability-sdk --foreground-scripts`. The default postinstall prepares Chromium matching the installed Patchright revision, LibreOffice/PyUNO, a minimal managed Python 3.11 environment and FFmpeg. It does not install sensitive-data inference packages or download model weights. Ready state is recorded only after executable checks and a real headless Chromium launch. The runtime fingerprint includes Patchright browser revision metadata, so dependency changes require a matching browser installation.

Supported targets are Windows x64 and Ubuntu 22.04/24.04 or Debian 12/13 on x64/arm64. Windows copies a working LibreOffice installation into the project or extracts a checksum-verified MSI. Linux prepares Office/PyUNO through apt, copies them into the project and prepares Python matching the UNO ABI. Missing Linux system packages require root or passwordless sudo. Managed Python does not replace system Python.

All managed components default to the consuming project root under `.capability-sdk/<platform>-<arch>/`. Add `.capability-sdk/` to `.gitignore`. Use the same `CAPABILITY_RUNTIME_HOME` at installation and runtime. Prepare the environment again after moving the project or changing machine/platform.

```sh
npx capability-runtime plan
npx capability-runtime install
npx capability-runtime doctor
```

Sensitive-data filtering is optional and disabled by default. Install its dependencies explicitly, or use the host Settings download action:

```sh
npx capability-runtime install sensitive-data
npx capability-runtime doctor sensitive-data
```

Its Python packages, CPU PyTorch, three default models and Hugging Face cache are isolated under `sensitive-data/venv`, `sensitive-data/models` and `sensitive-data/huggingface`. The separate `sensitive-data.json` readiness record is published after offline model loading succeeds. Removing this optional component does not invalidate `runtime.json` or require reinstalling browser, Office or code execution components. Ordinary SDK setup, Docker packaging and Orbit desktop packaging do not install or bundle these inference dependencies.

Readiness manifests record paths relative to the runtime directory; readers validate them and return absolute executable paths. New Python environments use uv relocatable launchers. Run the installer after moving a project to repair any broken interpreter links and validate the relocated components. Tools resolve recorded executable paths automatically. Explicit host settings take precedence. The `/runtime` entry exposes `readManagedRuntime()`, `readManagedSensitiveDataRuntime()` and `runtimeDirectory()`. Terminal children receive the prepared executable paths without changing the parent process environment.

`CAPABILITY_SKIP_RUNTIME_INSTALL=1` explicitly skips automatic preparation for separately provisioned images; run `capability-runtime install` later. npm `--ignore-scripts` can also skip native dependency scripts. Skipping installation does not establish readiness.

Business accounts, API keys, database servers, remote drivers and interactive desktop sessions remain host configuration. The built-in native desktop driver supports Windows only.

Implementation: [installer](scripts/runtime.cjs), [download specifications](runtime/managed/spec.json), [中文说明](RUNTIME.zh-CN.md).
