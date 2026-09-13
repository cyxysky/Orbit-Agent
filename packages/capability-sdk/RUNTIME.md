# Automatic runtime setup

React and React DOM are required peer dependencies installed automatically by npm. This lets frontend consumers share their existing React instance and avoids a dependency-resolution loop involving Excalidraw's older UI dependencies. No additional install command is needed.

Install the single package with `npm install @cjfclonedeep/capability-sdk`. Its `postinstall` prepares Chromium, LibreOffice/PyUNO, a managed Python 3.11 environment, CPU PyTorch and sensitive-data dependencies, all three default models, and FFmpeg. The first installation can take time and several GB; add `--foreground-scripts` to npm install for live output. Ready state is written only after executable checks, a headless Chromium launch and offline loading of all three models pass. Interrupted downloads and prepared components are reused on retry. Set the standard `HF_HUB_CACHE` variable to reuse an existing Hugging Face cache.

Supported automatic installation targets are Windows x64 and Ubuntu 22.04/24.04 or Debian 12/13 on x64/arm64. Windows copies a working LibreOffice installation into the project or extracts a checksum-verified official MSI there. Linux installs Office/PyUNO via apt, copies them into the project and prepares a local Python matching the UNO ABI. Linux shared system libraries and fonts remain system packages; missing packages require root or passwordless sudo. Python is managed by checksum-verified uv and does not replace system Python. Unsupported platforms fail explicitly.

All managed executables, Python dependencies, model weights and download caches default to the consuming project's `.capability-sdk/<platform>-<arch>/` directory (for example `.capability-sdk/win32-x64/`). npm postinstall locates the consuming project root, not the installed package directory. Run the application and runtime commands from that root. Add `.capability-sdk/` to `.gitignore`. Set `CAPABILITY_RUNTIME_HOME` to override the location explicitly, using the same value at install and runtime. Absolute paths and Python environments are project-specific: prepare again after moving the project or changing machine/platform. System shells and Linux OS libraries remain system-provided.

```sh
npx capability-runtime plan     # Read-only installation plan
npx capability-runtime doctor   # Validate the recorded environment
npx capability-runtime install  # Resume or repair installation
```

Tool implementations resolve the recorded paths automatically. Explicit host executable/model settings take precedence. The `/runtime` export exposes `readManagedRuntime()` and `runtimeDirectory()` for inspection. Terminal children receive a PATH containing the prepared executables without modifying the parent process environment.

`CAPABILITY_SKIP_RUNTIME_INSTALL=1` explicitly skips automatic preparation for separate image provisioning; run `capability-runtime install` later. npm `--ignore-scripts` also disables preparation and may skip native dependency installation scripts. Skipping does not mean the environment is ready.

Business accounts, API keys, database servers, remote drivers and interactive desktop sessions remain host configuration. The built-in native desktop driver supports Windows only; Linux desktop control needs an external driver. Automatic installation does not add platform support to that driver.

Implementation: [installer](scripts/runtime.cjs), [pinned downloads and checksums](runtime/managed/spec.json). [中文说明](RUNTIME.zh-CN.md).
