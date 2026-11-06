const path = require('node:path');

// A trusted Python bootstrap avoids a native Node addon. -I prevents a job's
// PYTHONPATH or working directory from running code before restrictions apply.
const bootstrap = String.raw`
import ctypes, json, mimetypes, os, stat, sys
libc = ctypes.CDLL(None, use_errno=True)
abi = libc.syscall(444, 0, 0, 1)
if abi < 3:
    raise RuntimeError('Linux code isolation requires Landlock ABI >= 3 (errno %s)' % ctypes.get_errno())
if sys.argv[1] == '--probe':
    if os.statvfs(sys.argv[2]).f_flag & os.ST_NOEXEC:
        raise RuntimeError('The sandbox workspace needs an exec-enabled mount for Python environments and native packages')
    print('Landlock ABI %s' % abi)
    sys.exit(0)
policy = json.loads(sys.argv[1])
class Ruleset(ctypes.Structure):
    _fields_ = [('filesystem', ctypes.c_uint64), ('network', ctypes.c_uint64), ('scoped', ctypes.c_uint64)]
class Rule(ctypes.Structure):
    _pack_ = 1
    _fields_ = [('access', ctypes.c_uint64), ('parent', ctypes.c_int32)]
handled = (1 << 15) - 1
if abi >= 5:
    handled |= 1 << 15
attributes = Ruleset(handled, 0, 3 if abi >= 6 else 0)
size = ctypes.sizeof(attributes) if abi >= 6 else 8
fd = libc.syscall(444, ctypes.byref(attributes), size, 0)
if fd < 0:
    raise OSError(ctypes.get_errno(), 'Cannot create Landlock ruleset')
def allow(filename, access):
    try:
        descriptor = os.open(filename, os.O_PATH | os.O_CLOEXEC)
    except FileNotFoundError:
        return
    try:
        if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
            access &= (1 << 0) | (1 << 1) | (1 << 2) | (1 << 14) | (1 << 15)
        rule = Rule(access, descriptor)
        if libc.syscall(445, fd, 1, ctypes.byref(rule), 0) < 0:
            raise OSError(ctypes.get_errno(), 'Cannot add Landlock path rule: ' + filename)
    finally:
        os.close(descriptor)
readonly = (1 << 0) | (1 << 2) | (1 << 3)
paths = ['/usr', '/bin', '/sbin', '/lib', '/lib64', sys.base_prefix, sys.prefix,
    '/etc/ssl', '/etc/ca-certificates', '/etc/resolv.conf', '/etc/hosts', '/etc/host.conf',
    '/etc/gai.conf', '/etc/nsswitch.conf', '/etc/passwd', '/etc/group', '/etc/ld.so.cache',
    '/etc/os-release', '/etc/lsb-release', '/etc/debian_version', '/etc/alpine-release', '/etc/redhat-release',
    '/etc/localtime', '/etc/fonts', '/proc/self', '/proc/cpuinfo', '/proc/meminfo', '/proc/stat',
    '/proc/uptime', '/sys/devices/system/cpu'] + mimetypes.knownfiles + policy['readonly']
for filename in set(paths):
    if os.path.realpath(filename) != '/':
        allow(filename, readonly)
for filename in ['/dev/null', '/dev/zero', '/dev/random', '/dev/urandom']:
    allow(filename, (1 << 1) | (1 << 2) | ((1 << 15) if abi >= 5 else 0))
allow(policy['workspace'], handled)
if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.syscall(446, fd, 0) != 0:
    raise OSError(ctypes.get_errno(), 'Cannot restrict sandbox filesystem')
os.close(fd)
os.umask(0o077)
os.execvpe(sys.argv[2], sys.argv[2:], os.environ)
`;

function landlockProbe(pythonExecutable, workspace) {
  return { executable: pythonExecutable, args: ['-I', '-c', bootstrap, '--probe', workspace] };
}
function landlockCommand(input, pythonExecutable, nodeExecutable, npmCli, additionalReadPaths = []) {
  const readonly = [nodeExecutable, ...additionalReadPaths];
  if (npmCli) readonly.push(path.dirname(path.dirname(npmCli)));
  return { executable: pythonExecutable, args: ['-I', '-c', bootstrap,
    JSON.stringify({ workspace: input.env.HOME ? path.dirname(input.env.HOME) : input.cwd, readonly }), input.executable, ...input.args] };
}
module.exports = { landlockProbe, landlockCommand };
