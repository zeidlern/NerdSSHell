// Compiled in memory by Windows PowerShell 5.1 after the caller verifies the
// SHA-256 of these exact UTF-8 bytes. This file is never a shell script.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

namespace BetterSSH {
  public static class ElevatedConsole {
    const int MaxData = 65536;
    const int MaxError = 1024;
    const int ConnectTimeout = 180000;
    const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    const uint CREATE_SUSPENDED = 0x00000004;
    const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);

    // The unelevated process owns the UI pipe. There is no generic command or
    // filesystem RPC crossing the elevation boundary.
    public static void Broker(string sourcePath, string expectedSha256, string nativeDirectory, string shellId, int ownerPid) {
      RunBroker(sourcePath, expectedSha256, nativeDirectory, shellId, ownerPid, false);
    }

    // Test-only entry point. The application does not call or expose it. It
    // runs exactly the same bridge without UAC so framing/lifecycle can be
    // exercised on disposable local consoles.
    public static void BrokerFixture(string sourcePath, string expectedSha256, string nativeDirectory, string shellId, int ownerPid) {
      RunBroker(sourcePath, expectedSha256, nativeDirectory, shellId, ownerPid, true);
    }

    static void RunBroker(string sourcePath, string expectedSha256, string nativeDirectory, string shellId, int ownerPid, bool fixture) {
      Stream stdout = Console.OpenStandardOutput();
      try {
        if (ownerPid <= 0 || ownerPid == Process.GetCurrentProcess().Id) throw new ArgumentException("Invalid owner process");
        IntPtr owner = OpenProcess(0x00100000, false, ownerPid); // SYNCHRONIZE
        if (owner == IntPtr.Zero || WaitForSingleObject(owner, 0) == 0) throw new IOException("Owner process is unavailable");
        Thread ownerMonitor = new Thread(() => {
          if (WaitForSingleObject(owner, 0xFFFFFFFF) == 0) Environment.Exit(0);
        });
        ownerMonitor.IsBackground = true;
        ownerMonitor.Start();
        ValidateSource(sourcePath, expectedSha256);
        ValidateNativePair(nativeDirectory); // Fail before UAC; the helper verifies its own reads again.
        ShellPath(shellId);
        byte[] nonce = new byte[32];
        using (RandomNumberGenerator rng = RandomNumberGenerator.Create()) rng.GetBytes(nonce);
        string nonceHex = Hex(nonce);
        string name = "BetterSSH-elevated-" + Guid.NewGuid().ToString("N");
        using (NamedPipeServerStream pipe = PrivatePipe(name)) {
          ParentInput parentInput = StartParentInput(pipe);
          Process high;
          try { high = StartHelper(sourcePath, expectedSha256, nativeDirectory, shellId, name, nonceHex, fixture); }
          catch (Win32Exception ex) {
            if (ex.NativeErrorCode == 1223) { WriteFrame(stdout, 'X', new byte[0]); return; }
            throw;
          }
          using (high) {
            IAsyncResult pending = pipe.BeginWaitForConnection(null, null);
            int waited = 0;
            while (!pending.AsyncWaitHandle.WaitOne(100)) {
              waited += 100;
              if (high.HasExited) throw new IOException("Administrator helper exited before connecting");
              if (waited >= ConnectTimeout) throw new IOException("Administrator connection timed out");
            }
            pipe.EndWaitForConnection(pending);
            uint actualPid;
            if (!GetNamedPipeClientProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out actualPid) || actualPid != (uint)high.Id)
              throw new IOException("Administrator process identity mismatch");
            byte[] received = ReadExactTimed(pipe, 32, 10000);
            if (!Equal(received, nonce)) throw new IOException("Administrator handshake failed");
            pipe.Write(nonce, 0, nonce.Length);
            pipe.Flush();
            Relay(pipe, stdout, parentInput);
          }
        }
      } catch (Exception ex) {
        TryError(stdout, ex);
      }
    }

    public static void Helper(string pipeName, string nonceHex, int brokerPid, string nativeDirectory, string shellId) {
      RunHelper(pipeName, nonceHex, brokerPid, nativeDirectory, shellId, false);
    }

    // Test-only counterpart to BrokerFixture. No elevation is requested; the
    // shell inherits the fixture runner's token.
    public static void HelperFixture(string pipeName, string nonceHex, int brokerPid, string nativeDirectory, string shellId) {
      RunHelper(pipeName, nonceHex, brokerPid, nativeDirectory, shellId, true);
    }

    static void RunHelper(string pipeName, string nonceHex, int brokerPid, string nativeDirectory, string shellId, bool fixture) {
      if (!fixture && !IsElevated()) throw new InvalidOperationException("Administrator token required");
      if (brokerPid <= 0 || pipeName == null || !pipeName.StartsWith("BetterSSH-elevated-", StringComparison.Ordinal) || pipeName.Length != 51)
        throw new ArgumentException("Invalid broker identity");
      byte[] nonce = ParseHex(nonceHex);
      if (nonce.Length != 32) throw new ArgumentException("Invalid handshake");
      string shell = ShellPath(shellId);
      IntPtr initialBroker = OpenProcess(0x00100000, false, brokerPid);
      if (initialBroker == IntPtr.Zero) throw new IOException("Broker process is unavailable");
      try { if (WaitForSingleObject(initialBroker, 0) == 0) throw new IOException("Broker process has exited"); }
      finally { CloseHandle(initialBroker); }
      using (NamedPipeClientStream pipe = new NamedPipeClientStream(".", pipeName, PipeDirection.InOut, PipeOptions.Asynchronous)) {
        pipe.Connect(10000);
        uint actualPid;
        if (!GetNamedPipeServerProcessId(pipe.SafePipeHandle.DangerousGetHandle(), out actualPid) || actualPid != (uint)brokerPid)
          throw new IOException("Broker process identity mismatch");
        pipe.Write(nonce, 0, nonce.Length);
        pipe.Flush();
        if (!Equal(ReadExactTimed(pipe, 32, 10000), nonce)) throw new IOException("Broker handshake failed");
        IntPtr brokerHandle = OpenProcess(0x00100000, false, brokerPid); // SYNCHRONIZE
        if (brokerHandle == IntPtr.Zero) throw new IOException("Broker process is unavailable");
        try { using (PseudoTerminal terminal = new PseudoTerminal(shell, shellId, nativeDirectory, fixture)) {
          object outputLock = new object();
          Thread output = new Thread(() => {
            bool forward = true;
            try {
              byte[] block = new byte[16384];
              for (;;) {
                int count = terminal.ReadOutput(block);
                if (count == 0) break;
                if (forward) {
                  byte[] bytes = new byte[count];
                  Buffer.BlockCopy(block, 0, bytes, 0, count);
                  try { lock (outputLock) WriteFrame(pipe, 'D', bytes); }
                  catch (IOException) { forward = false; }
                  catch (ObjectDisposedException) { forward = false; }
                }
              }
            } catch (IOException) { } catch (ObjectDisposedException) { } catch (Win32Exception) { }
          });
          lock (outputLock) WriteFrame(pipe, 'R', new byte[0]);
          output.IsBackground = true;
          output.Start();
          Thread exitMonitor = new Thread(() => {
            terminal.WaitForExit();
            terminal.CloseConsole();
            output.Join(); // E follows the complete ConPTY output tail.
            try {
              lock (outputLock) WriteFrame(pipe, 'E', BitConverter.GetBytes(terminal.ExitCode));
            } catch (IOException) { } catch (ObjectDisposedException) { }
            try { pipe.Dispose(); } catch { }
          });
          exitMonitor.IsBackground = true;
          exitMonitor.Start();
          StopFlag stop = new StopFlag();
          Thread ownerMonitor = new Thread(() => {
            while (!stop.Value) {
              if (WaitForSingleObject(brokerHandle, 500) == 0) {
                try { pipe.Dispose(); } catch { }
                terminal.Stop();
                break;
              }
            }
          });
          ownerMonitor.IsBackground = true;
          ownerMonitor.Start();
          try {
            for (;;) {
              Frame frame = ReadFrame(pipe, MaxData);
              if (frame.Type == 'C' && frame.Data.Length == 0) break;
              if (frame.Type == 'I' && frame.Data.Length <= MaxData) {
                // Validate UTF-8 to prevent malformed terminal input crossing
                // the elevated boundary. No interpretation occurs here.
                Utf8.GetString(frame.Data);
                terminal.WriteInput(frame.Data);
              } else if (frame.Type == 'S' && frame.Data.Length == 4) {
                int cols = frame.Data[0] | frame.Data[1] << 8;
                int rows = frame.Data[2] | frame.Data[3] << 8;
                if (cols < 20 || cols > 1000 || rows < 5 || rows > 500) throw new IOException("Invalid terminal size");
                terminal.Resize((short)cols, (short)rows);
              } else throw new IOException("Invalid terminal frame");
              if (terminal.HasExited) break;
            }
          } catch (EndOfStreamException) { /* Broker gone: dispose job now. */ }
          catch (IOException) { /* Broken pipe or invalid frame: fail closed. */ }
          catch (Win32Exception) { /* Native PTY failure: fail closed. */ }
          finally {
            stop.Value = true;
            terminal.Stop();
            ownerMonitor.Join(1000);
            exitMonitor.Join();
            output.Join(); // Native delegates/files outlive every console call and output read.
          }
        } } catch (Exception ex) {
          // Fixture diagnostics use the existing bounded F frame after peer
          // authentication. Production retains its generic, path-free error.
          if (fixture) TryFixtureError(pipe, ex); else TryError(pipe, ex);
        } finally { CloseHandle(brokerHandle); }
      }
    }

    sealed class StopFlag { public volatile bool Value; }

    sealed class ParentInput { public volatile bool Ready; }
    static ParentInput StartParentInput(Stream pipe) {
      ParentInput state = new ParentInput();
      Thread inbound = new Thread(() => {
        try {
          Stream stdin = Console.OpenStandardInput();
          byte[] first = new byte[1];
          for (;;) {
            if (stdin.Read(first, 0, 1) == 0 || !state.Ready) break;
            byte[] rest = ReadExact(stdin, 4);
            uint size = BitConverter.ToUInt32(rest, 0);
            if (size > MaxData) break;
            Frame f = new Frame { Type = (char)first[0], Data = ReadExact(stdin, (int)size) };
            if ((f.Type != 'I' && f.Type != 'S' && f.Type != 'C') ||
                (f.Type == 'S' && f.Data.Length != 4) || (f.Type == 'C' && f.Data.Length != 0)) break;
            WriteFrame(pipe, f.Type, f.Data);
            if (f.Type == 'C') { pipe.Dispose(); return; }
          }
        } catch { }
        // This runs even while UAC is pending. Ending the broker closes its
        // process handle, which the elevated helper monitors independently.
        try { pipe.Dispose(); } catch { }
        Environment.Exit(0);
      });
      inbound.IsBackground = true;
      inbound.Start();
      return state;
    }
    static void Relay(Stream pipe, Stream stdout, ParentInput parentInput) {
      try {
        for (;;) {
          Frame f = ReadFrame(pipe, MaxData);
          if ((f.Type != 'D' && f.Type != 'R' && f.Type != 'X' && f.Type != 'E' && f.Type != 'F') ||
              (f.Type == 'R' && f.Data.Length != 0) || (f.Type == 'X' && f.Data.Length != 0) ||
              (f.Type == 'E' && f.Data.Length != 4) || (f.Type == 'F' && f.Data.Length > MaxError))
            throw new IOException("Invalid administrator frame");
          if (f.Type == 'R') parentInput.Ready = true;
          WriteFrame(stdout, f.Type, f.Data);
          if (f.Type == 'E' || f.Type == 'F' || f.Type == 'X') break;
        }
      } catch (EndOfStreamException) { }
    }

    struct Frame { public char Type; public byte[] Data; }
    static Frame ReadFrame(Stream stream, int maximum) {
      byte[] header = ReadExact(stream, 5);
      uint length = BitConverter.ToUInt32(header, 1);
      if (length > maximum) throw new IOException("Oversized terminal frame");
      return new Frame { Type = (char)header[0], Data = ReadExact(stream, (int)length) };
    }
    static void WriteFrame(Stream stream, char type, byte[] data) {
      if (data.Length > MaxData) throw new IOException("Oversized terminal frame");
      byte[] header = new byte[5];
      header[0] = (byte)type;
      Buffer.BlockCopy(BitConverter.GetBytes((uint)data.Length), 0, header, 1, 4);
      stream.Write(header, 0, header.Length);
      if (data.Length != 0) stream.Write(data, 0, data.Length);
      stream.Flush();
    }
    static byte[] ReadExact(Stream stream, int count) {
      byte[] bytes = new byte[count];
      int used = 0;
      while (used < count) {
        int read = stream.Read(bytes, used, count - used);
        if (read == 0) throw new EndOfStreamException();
        used += read;
      }
      return bytes;
    }
    static byte[] ReadExactTimed(Stream stream, int count, int timeout) {
      byte[] bytes = new byte[count];
      int used = 0;
      Stopwatch watch = Stopwatch.StartNew();
      while (used < count) {
        IAsyncResult pending = stream.BeginRead(bytes, used, count - used, null, null);
        int left = timeout - (int)watch.ElapsedMilliseconds;
        if (left <= 0 || !pending.AsyncWaitHandle.WaitOne(left)) throw new IOException("Administrator handshake timed out");
        int read = stream.EndRead(pending);
        if (read == 0) throw new EndOfStreamException();
        used += read;
      }
      return bytes;
    }

    static NamedPipeServerStream PrivatePipe(string name) {
      string sid = WindowsIdentity.GetCurrent().User.Value;
      string sddl = "D:P(A;;GA;;;" + sid + ")(A;;GA;;;BA)(A;;GA;;;SY)";
      IntPtr descriptor;
      if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, IntPtr.Zero))
        throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
        security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
        security.lpSecurityDescriptor = descriptor;
        IntPtr handle = CreateNamedPipe("\\\\.\\pipe\\" + name,
          0x00000003 | 0x00080000 | 0x40000000, // duplex, first instance, overlapped
          0x00000000 | 0x00000008, // byte stream, reject remote clients
          1, 65536, 65536, 0, ref security);
        if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return new NamedPipeServerStream(PipeDirection.InOut, true, true,
          new Microsoft.Win32.SafeHandles.SafePipeHandle(handle, true));
      } finally { LocalFree(descriptor); }
    }

    static Process StartHelper(string source, string digest, string nativeDirectory, string shell, string pipe, string nonce, bool fixture) {
      int parentPid = Process.GetCurrentProcess().Id;
      string method = fixture ? "HelperFixture" : "Helper";
      string script = "$ErrorActionPreference='Stop';" +
        "$f=[IO.File]::OpenRead(" + Quote(source) + ");" +
        "try{$b=New-Object byte[] 131073;$n=0;while($n -lt $b.Length){$r=$f.Read($b,$n,$b.Length-$n);if($r -eq 0){break};$n+=$r};if($n -gt 131072){exit 2};[Array]::Resize([ref]$b,$n)}finally{$f.Dispose()};" +
        "$h=[BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($b)).Replace('-','').ToLowerInvariant();" +
        "if($h -ne " + Quote(digest.ToLowerInvariant()) + "){exit 2};" +
        "Add-Type -TypeDefinition ([Text.Encoding]::UTF8.GetString($b)) -Language CSharp;" +
        "[BetterSSH.ElevatedConsole]::" + method + "(" + Quote(pipe) + "," + Quote(nonce) + "," + parentPid + "," + Quote(nativeDirectory) + "," + Quote(shell) + ");";
      string encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
      if (encoded.Length > 24000) throw new IOException("Administrator bootstrap too long");
      ProcessStartInfo start = new ProcessStartInfo();
      start.FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      start.Arguments = "-NoLogo -NoProfile -NonInteractive -EncodedCommand " + encoded;
      start.UseShellExecute = true;
      if (!fixture) start.Verb = "runas";
      start.WindowStyle = ProcessWindowStyle.Hidden;
      return Process.Start(start);
    }

    static string ShellPath(string shellId) {
      string shell;
      if (shellId == "local:powershell" || shellId == "powershell")
        shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      else if (shellId == "local:pwsh" || shellId == "pwsh")
        shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "PowerShell", "7", "pwsh.exe");
      else if (shellId == "local:cmd")
        shell = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "cmd.exe");
      else throw new ArgumentException("Unknown local shell");
      if (!File.Exists(shell)) throw new FileNotFoundException("Local shell not installed");
      return shell;
    }
    static void ValidateSource(string source, string expected) {
      if (expected == null || expected.Length != 64) throw new ArgumentException("Invalid source digest");
      byte[] bytes = new byte[131073];
      int count = 0;
      using (FileStream file = File.OpenRead(source)) {
        while (count < bytes.Length) {
          int read = file.Read(bytes, count, bytes.Length - count);
          if (read == 0) break;
          count += read;
        }
      }
      if (count > 131072) throw new IOException("Administrator source too large");
      using (SHA256 sha = SHA256.Create())
        if (!string.Equals(Hex(sha.ComputeHash(bytes, 0, count)), expected, StringComparison.OrdinalIgnoreCase))
          throw new IOException("Administrator source digest mismatch");
    }
    static bool IsElevated() {
      using (WindowsIdentity identity = WindowsIdentity.GetCurrent()) {
        byte[] elevation = new byte[4];
        int returned;
        if (!GetTokenInformation(identity.Token, 20, elevation, elevation.Length, out returned) || returned != 4)
          throw new Win32Exception(Marshal.GetLastWin32Error());
        return BitConverter.ToInt32(elevation, 0) != 0;
      }
    }
    static string Quote(string value) { return "'" + value.Replace("'", "''") + "'"; }
    static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
    static byte[] ParseHex(string s) {
      if (s == null || s.Length != 64) throw new ArgumentException("Invalid nonce");
      byte[] b = new byte[32];
      for (int i = 0; i < b.Length; ++i) b[i] = Convert.ToByte(s.Substring(i * 2, 2), 16);
      return b;
    }
    static bool Equal(byte[] a, byte[] b) {
      if (a.Length != b.Length) return false;
      int diff = 0;
      for (int i = 0; i < a.Length; ++i) diff |= a[i] ^ b[i];
      return diff == 0;
    }
    static void TryError(Stream outstream, Exception ex) {
      try {
        string message = ex is EndOfStreamException ? "Administrator console disconnected" :
          ex is Win32Exception ? "Administrator console could not start" :
          ex is IOException ? "Administrator console connection failed" :
          "Administrator console failed";
        byte[] data = Utf8.GetBytes(message);
        WriteFrame(outstream, 'F', data);
      } catch { }
    }
    static void TryFixtureError(Stream outstream, Exception ex) {
      try {
        Win32Exception native = ex as Win32Exception;
        string message = ex.GetType().Name + (native == null ? "" : " [" + native.NativeErrorCode + "]") + ": " + ex.Message;
        if (message.Length > 240) message = message.Substring(0, 240);
        if (message.Length > 0 && char.IsHighSurrogate(message[message.Length - 1])) message = message.Substring(0, message.Length - 1);
        WriteFrame(outstream, 'F', Utf8.GetBytes(message));
      } catch { }
    }

    // These are the reviewed node-pty 1.2.0-beta.15 / ConPTY 1.25.260303002
    // x64 bytes, not caller-provided digests. Never load conpty.node elevated.
    const string ConptySha256 = "3319b484b80bb53d1f4d0a9eb0ea60fd0f61da69db7280ca43b84215f19245ff";
    const string OpenConsoleSha256 = "7f68c840226505004215c0b82d4e502c24b5bc3f4b93c4baaaa19bd679c0def8";
    const string AdministratorsSid = "S-1-5-32-544";
    const string SystemSid = "S-1-5-18";
    const string TrustedInstallerSid = "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464";
    const uint READ_CONTROL = 0x00020000;
    const uint FILE_READ_ATTRIBUTES = 0x00000080;

    static string NativeDirectoryPath(string value) {
      if (string.IsNullOrEmpty(value) || value.Length > 1024 || value.Length < 3 ||
          !((value[0] >= 'A' && value[0] <= 'Z') || (value[0] >= 'a' && value[0] <= 'z')) ||
          value[1] != ':' || (value[2] != '\\' && value[2] != '/') || value.IndexOf(':', 2) >= 0)
        throw new IOException("Native provider requires an absolute local drive path");
      foreach (char c in value)
        if (c < 32 || c == 127 || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|')
          throw new IOException("Invalid native provider path");
      string full = Path.GetFullPath(value);
      foreach (string part in full.Substring(3).Split('\\'))
        if (part.EndsWith(".", StringComparison.Ordinal) || part.EndsWith(" ", StringComparison.Ordinal))
          throw new IOException("Ambiguous native provider path");
      return full.Length > 3 ? full.TrimEnd('\\') : full;
    }
    static void CheckDiskPath(IntPtr handle, string expected, bool directory) {
      BY_HANDLE_FILE_INFORMATION info;
      if (GetFileType(handle) != 1 || !GetFileInformationByHandle(handle, out info))
        throw new IOException("Native provider requires a disk file");
      if ((info.FileAttributes & 0x400) != 0 || ((info.FileAttributes & 0x10) != 0) != directory)
        throw new IOException("Native provider reparse point or file type rejected");
      StringBuilder final = new StringBuilder(2048);
      uint length = GetFinalPathNameByHandle(handle, final, (uint)final.Capacity, 0);
      if (length == 0 || length >= final.Capacity) throw new IOException("Native provider path could not be resolved");
      string actual = final.ToString();
      if (actual.StartsWith(@"\\?\", StringComparison.Ordinal)) actual = actual.Substring(4);
      if (!string.Equals(actual.TrimEnd('\\'), expected.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        throw new IOException("Native provider resolved path mismatch");
    }
    static IntPtr OpenDiskPath(string path, bool directory, uint access, uint share) {
      IntPtr handle = OpenNativeFile(path, access, share, IntPtr.Zero, 3,
        0x00100000u | 0x00200000u | (directory ? 0x02000000u : 0u), IntPtr.Zero);
      // OPEN_REPARSE_POINT + BACKUP_SEMANTICS; SQOS_PRESENT/ANONYMOUS
      // prevents a raced source-path redirection from offering impersonation
      // before the disk type and final-path checks can reject its handle.
      if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
      try { CheckDiskPath(handle, path, directory); return handle; }
      catch { CloseHandle(handle); throw; }
    }
    static bool TrustedOwner(string sid, string fixtureSid) {
      return sid == AdministratorsSid || sid == SystemSid || sid == TrustedInstallerSid ||
        (fixtureSid != null && sid == fixtureSid);
    }
    static void ValidateProtectedDirectory(IntPtr handle, bool allowChildCreation, string fixtureSid, bool privateStage) {
      IntPtr owner, group, dacl, sacl, descriptor;
      uint error = GetSecurityInfo(handle, 1, 0x00000001 | 0x00000004, out owner, out group, out dacl, out sacl, out descriptor);
      if (error != 0) throw new Win32Exception((int)error);
      try {
        uint length = GetSecurityDescriptorLength(descriptor);
        if (length == 0 || length > 65536 || dacl == IntPtr.Zero) throw new IOException("Native staging ACL unavailable");
        byte[] bytes = new byte[(int)length];
        Marshal.Copy(descriptor, bytes, 0, bytes.Length);
        DirectorySecurity security = new DirectorySecurity();
        security.SetSecurityDescriptorBinaryForm(bytes);
        string ownerSid = security.GetOwner(typeof(SecurityIdentifier)).Value;
        if (!TrustedOwner(ownerSid, fixtureSid) ||
            (privateStage && ownerSid != (fixtureSid ?? AdministratorsSid) && ownerSid != SystemSid) ||
            (privateStage && !security.AreAccessRulesProtected))
          throw new IOException("Native staging owner or protected ACL rejected");
        FileSystemRights dangerous = FileSystemRights.Delete | FileSystemRights.DeleteSubdirectoriesAndFiles |
          FileSystemRights.ChangePermissions | FileSystemRights.TakeOwnership |
          FileSystemRights.WriteAttributes | FileSystemRights.WriteExtendedAttributes;
        // Stock C:\ grants some principals the right to create NEW children.
        // That cannot replace our held existing Program Files ancestor. At the
        // actual stage parent, also require all creation/write rights trusted.
        if (!allowChildCreation) dangerous |= FileSystemRights.Write;
        foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(SecurityIdentifier))) {
          if (rule.AccessControlType != AccessControlType.Allow || (rule.PropagationFlags & PropagationFlags.InheritOnly) != 0) continue;
          string sid = rule.IdentityReference.Value;
          if (!TrustedOwner(sid, fixtureSid) && (privateStage || (rule.FileSystemRights & dangerous) != 0))
            throw new IOException("Native staging permits untrusted changes");
        }
      } finally { LocalFree(descriptor); }
    }
    sealed class DirectoryPins : IDisposable {
      readonly List<IntPtr> handles = new List<IntPtr>();
      public DirectoryPins(string directory, bool protect, string fixtureSid) {
        try {
          string root = Path.GetPathRoot(directory);
          string current = root;
          string[] parts = directory.Substring(root.Length).Split(new char[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
          for (int i = 0; i <= parts.Length; i++) {
            if (i > 0) current = Path.Combine(current, parts[i - 1]);
            // No DELETE sharing: no ancestor may be renamed or replaced while
            // a source is read, or while staged images are loaded and cleaned.
            IntPtr handle = OpenDiskPath(current, true, READ_CONTROL | FILE_READ_ATTRIBUTES, 1 | 2);
            handles.Add(handle);
            if (protect) ValidateProtectedDirectory(handle, i < parts.Length, fixtureSid, false);
          }
        } catch { Dispose(); throw; }
      }
      public void Dispose() { for (int i = handles.Count - 1; i >= 0; i--) CloseHandle(handles[i]); handles.Clear(); }
    }
    static byte[] ReadPinnedNative(IntPtr handle, string digest, int maximum) {
      BY_HANDLE_FILE_INFORMATION info;
      if (!GetFileInformationByHandle(handle, out info) || info.FileSizeHigh != 0 || info.FileSizeLow == 0 || info.FileSizeLow > maximum)
        throw new IOException("Native provider file exceeds its bound");
      byte[] bytes = new byte[(int)info.FileSizeLow];
      using (FileStream stream = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(handle, false), FileAccess.Read)) {
        int count = 0;
        while (count < bytes.Length) {
          int read = stream.Read(bytes, count, bytes.Length - count);
          if (read == 0) throw new IOException("Native provider was truncated");
          count += read;
        }
        if (stream.ReadByte() != -1) throw new IOException("Native provider changed size");
      }
      using (SHA256 sha = SHA256.Create())
        if (!string.Equals(Hex(sha.ComputeHash(bytes)), digest, StringComparison.Ordinal))
          throw new IOException("Native provider digest mismatch");
      return bytes;
    }
    static byte[] ReadNativeFile(string path, string digest, int maximum) {
      IntPtr handle = OpenDiskPath(path, false, 0x80000000, 1); // read, deny write/delete
      try { return ReadPinnedNative(handle, digest, maximum); }
      finally { CloseHandle(handle); }
    }
    static byte[][] ReadNativePair(string directory) {
      if (IntPtr.Size != 8) throw new IOException("Native provider requires an x64 helper");
      directory = NativeDirectoryPath(directory);
      using (DirectoryPins pins = new DirectoryPins(directory, false, null)) {
        // Verify BOTH exact buffers before creating a stage or loading code.
        byte[] dll = ReadNativeFile(Path.Combine(directory, "conpty.dll"), ConptySha256, 1024 * 1024);
        byte[] exe = ReadNativeFile(Path.Combine(directory, "OpenConsole.exe"), OpenConsoleSha256, 8 * 1024 * 1024);
        return new byte[][] { dll, exe };
      }
    }
    static void ValidateNativePair(string directory) { ReadNativePair(directory); }

    sealed class NativeProvider : IDisposable {
      [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int CreateConsole(COORD size, IntPtr input, IntPtr output, uint flags, out IntPtr console);
      [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int ResizeConsole(IntPtr console, COORD size);
      [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int ReleaseConsole(IntPtr console);
      [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate void CloseConsole(IntPtr console);
      readonly List<IntPtr> filePins = new List<IntPtr>();
      readonly List<string> ownedFiles = new List<string>();
      DirectoryPins parents;
      IntPtr stagePin, module;
      string stage;
      CreateConsole create;
      ResizeConsole resize;
      ReleaseConsole release;
      CloseConsole close;
      public NativeProvider(string source, bool fixture) {
        try {
          byte[][] bytes = ReadNativePair(source);
          // Only an UNELEVATED test fixture uses a current-user-owned Temp
          // stage. Production and elevated fixtures always use the same
          // administrator/System-only Program Files stage and security checks.
          string fixtureSid = fixture && !IsElevated() ? WindowsIdentity.GetCurrent().User.Value : null;
          string parent = NativeDirectoryPath(fixtureSid == null ?
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) : Path.GetTempPath());
          parents = new DirectoryPins(parent, true, fixtureSid);
          string sddl = fixtureSid == null ? "O:BAG:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)" :
            "O:" + fixtureSid + "D:P(A;;FA;;;SY)(A;;FA;;;" + fixtureSid + ")";
          IntPtr descriptor;
          if (!ConvertStringSecurityDescriptorToSecurityDescriptor(sddl, 1, out descriptor, IntPtr.Zero))
            throw new Win32Exception(Marshal.GetLastWin32Error());
          try {
            SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES();
            security.nLength = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES));
            security.lpSecurityDescriptor = descriptor;
            string fresh = Path.Combine(parent, "NerdSSHell-ConPTY-" + Guid.NewGuid().ToString("N"));
            if (!CreateNativeDirectory(fresh, ref security)) throw new Win32Exception(Marshal.GetLastWin32Error());
            stage = fresh; // Only a successful exclusive creation grants cleanup ownership.
            stagePin = OpenDiskPath(stage, true, READ_CONTROL | FILE_READ_ATTRIBUTES, 1 | 2);
            ValidateProtectedDirectory(stagePin, false, fixtureSid, true);
            WriteStageFile("conpty.dll", bytes[0], ConptySha256, 1024 * 1024, fixtureSid, ref security);
            WriteStageFile("OpenConsole.exe", bytes[1], OpenConsoleSha256, 8 * 1024 * 1024, fixtureSid, ref security);
          } finally { LocalFree(descriptor); }
          // Absolute DLL path, dependencies only in this protected directory
          // and System32. No PATH/CWD lookup and no system-provider fallback.
          module = LoadLibraryEx(Path.Combine(stage, "conpty.dll"), IntPtr.Zero, 0x00000100 | 0x00000800);
          if (module == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
          create = (CreateConsole)Function("ConptyCreatePseudoConsole", typeof(CreateConsole));
          resize = (ResizeConsole)Function("ConptyResizePseudoConsole", typeof(ResizeConsole));
          release = (ReleaseConsole)Function("ConptyReleasePseudoConsole", typeof(ReleaseConsole));
          close = (CloseConsole)Function("ConptyClosePseudoConsole", typeof(CloseConsole));
        } catch { Dispose(); throw; }
      }
      void WriteStageFile(string name, byte[] bytes, string digest, int maximum, string fixtureSid, ref SECURITY_ATTRIBUTES security) {
        string file = Path.Combine(stage, name);
        IntPtr writer = CreateNativeFile(file, 0x40000000, 0, ref security, 1, 0x00200000, IntPtr.Zero); // CREATE_NEW
        if (writer == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        ownedFiles.Add(file);
        using (FileStream stream = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(writer, true), FileAccess.Write)) {
          stream.Write(bytes, 0, bytes.Length);
          stream.Flush(true);
        }
        // Writable handles are closed before image loading. Read-only pins
        // deny both modification and deletion until the native lifetime ends.
        IntPtr pin = OpenDiskPath(file, false, 0x80000000 | READ_CONTROL, 1);
        filePins.Add(pin);
        ValidateProtectedDirectory(pin, false, fixtureSid, true);
        ReadPinnedNative(pin, digest, maximum);
      }
      Delegate Function(string name, Type type) {
        IntPtr address = GetProcAddress(module, name);
        if (address == IntPtr.Zero) throw new IOException("Native provider export unavailable");
        return Marshal.GetDelegateForFunctionPointer(address, type);
      }
      public int Create(COORD size, IntPtr input, IntPtr output, out IntPtr console) {
        string directory = Environment.CurrentDirectory;
        string path = Environment.GetEnvironmentVariable("PATH", EnvironmentVariableTarget.Process);
        try {
          // The pinned OpenConsole starts with inherited CWD/environment and
          // can delay-load ICU or .\\console.dll. Give ONLY that child a safe
          // CWD/PATH; restore the original shell environment before its spawn.
          Environment.CurrentDirectory = stage;
          Environment.SetEnvironmentVariable("PATH", Environment.SystemDirectory, EnvironmentVariableTarget.Process);
          return create(size, input, output, 0, out console);
        } finally {
          try { Environment.CurrentDirectory = directory; }
          catch {
            // A removed caller-owned CWD must not leave our own process
            // holding the stage open. Fail this launch after moving to System32.
            Environment.CurrentDirectory = Environment.SystemDirectory;
            throw;
          } finally { Environment.SetEnvironmentVariable("PATH", path, EnvironmentVariableTarget.Process); }
        }
      }
      public int Resize(IntPtr console, COORD size) { return resize(console, size); }
      public int Release(IntPtr console) { return release(console); }
      public void Close(IntPtr console) { close(console); }
      public void Dispose() {
        if (module != IntPtr.Zero) { FreeLibrary(module); module = IntPtr.Zero; }
        for (int i = filePins.Count - 1; i >= 0; i--) CloseHandle(filePins[i]);
        filePins.Clear();
        // Modern ConptyClosePseudoConsole does not wait for OpenConsole exit.
        // After output EOF, its image/CWD can still need a short time to close.
        // Delete only our two exclusively created files, never recursive data.
        bool removed = stage == null;
        try {
          if (stage != null) {
            Stopwatch watch = Stopwatch.StartNew();
            do {
              bool filesGone = true;
              foreach (string file in ownedFiles)
                if (!DeleteNativeFile(file) && Marshal.GetLastWin32Error() != 2) filesGone = false;
              if (filesGone) {
                if (stagePin != IntPtr.Zero) { CloseHandle(stagePin); stagePin = IntPtr.Zero; }
                if (RemoveNativeDirectory(stage) || Marshal.GetLastWin32Error() == 2) { removed = true; stage = null; break; }
              }
              Thread.Sleep(25);
            } while (watch.ElapsedMilliseconds < 3000);
          }
        } finally {
          if (stagePin != IntPtr.Zero) { CloseHandle(stagePin); stagePin = IntPtr.Zero; }
          if (parents != null) { parents.Dispose(); parents = null; }
        }
        if (!removed) throw new IOException("Native provider stage could not be removed");
      }
    }

    sealed class PseudoTerminal : IDisposable {
      IntPtr hpc, job, process, inputHandle, outputHandle;
      NativeProvider provider;
      int disposed;
      bool assigned;
      readonly object consoleLock = new object();
      public bool HasExited { get { uint result = WaitForSingleObject(process, 0); return result == 0; } }
      public int ExitCode { get { uint code; if (!GetExitCodeProcess(process, out code)) return -1; return unchecked((int)code); } }
      public PseudoTerminal(string executable, string shellId, string nativeDirectory, bool fixture) {
        IntPtr inputRead = IntPtr.Zero, inputWrite = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero;
        IntPtr attributes = IntPtr.Zero, thread = IntPtr.Zero;
        try {
          provider = new NativeProvider(nativeDirectory, fixture);
          if (!CreatePipe(out inputRead, out inputWrite, IntPtr.Zero, 0) || !CreatePipe(out outputRead, out outputWrite, IntPtr.Zero, 0))
            throw new Win32Exception(Marshal.GetLastWin32Error());
          COORD size = new COORD { X = 120, Y = 36 };
          int hr = provider.Create(size, inputRead, outputWrite, out hpc);
          if (hr < 0) Marshal.ThrowExceptionForHR(hr);
          IntPtr attrSize = IntPtr.Zero;
          InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attrSize);
          attributes = Marshal.AllocHGlobal(attrSize);
          if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref attrSize)) throw new Win32Exception(Marshal.GetLastWin32Error());
          if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE), hpc,
            new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
          STARTUPINFOEX startup = new STARTUPINFOEX();
          startup.StartupInfo.cb = Marshal.SizeOf(typeof(STARTUPINFOEX));
          startup.lpAttributeList = attributes;
          PROCESS_INFORMATION info;
          string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
          // Fixed, process-local PSReadLine colors; no profile, history file,
          // user command or script path is evaluated during launch.
          const string syntax = @"& {
            $bettersshModule = [IO.Path]::Combine($PSHOME, 'Modules', 'PSReadLine', 'PSReadLine.psd1')
            if (![IO.File]::Exists($bettersshModule) -and $PSVersionTable.PSVersion.Major -le 5) {
              $root = [IO.Path]::Combine([Environment]::GetFolderPath([Environment+SpecialFolder]::ProgramFiles), 'WindowsPowerShell', 'Modules', 'PSReadLine')
              if ([IO.Directory]::Exists($root)) {
                if (([IO.File]::GetAttributes($root) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }
                $bettersshModule = [IO.Path]::Combine($root, 'PSReadLine.psd1')
                if (![IO.File]::Exists($bettersshModule)) {
                  $best = [version]'0.0'; $seen = 0
                  foreach ($dir in [IO.Directory]::EnumerateDirectories($root)) {
                    $seen++; if ($seen -gt 32) { exit 2 }
                    $name = [IO.Path]::GetFileName($dir)
                    if ($name -notmatch '^\d+\.\d+(\.\d+){0,2}$') { continue }
                    $candidate = [IO.Path]::Combine($dir, 'PSReadLine.psd1')
                    if (([IO.File]::GetAttributes($dir) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { continue }
                    if ([IO.File]::Exists($candidate) -and [version]$name -gt $best) {
                      $best = [version]$name; $bettersshModule = $candidate
                    }
                  }
                }
              }
            }
            if (![IO.File]::Exists($bettersshModule)) { $bettersshModule = $null }
            if ($bettersshModule -and ([IO.File]::GetAttributes($bettersshModule) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 2 }
            $loaded = @(Microsoft.PowerShell.Core\Get-Module PSReadLine)
            if ($loaded.Count -gt 1 -or ($loaded.Count -eq 1 -and !$bettersshModule)) { exit 2 }
            if ($loaded.Count -eq 1) {
              $folder = [IO.Path]::GetDirectoryName($bettersshModule)
              $binaryModule = [IO.Path]::Combine($folder, 'PSReadLine.psm1')
              $actual = [IO.Path]::GetFullPath($loaded[0].Path)
              if (![string]::Equals($actual, $bettersshModule, [StringComparison]::OrdinalIgnoreCase) -and
                  ![string]::Equals($actual, $binaryModule, [StringComparison]::OrdinalIgnoreCase)) { exit 2 }
            }
            if ($bettersshModule) {
              try { Microsoft.PowerShell.Core\Import-Module -Name $bettersshModule -Force -ErrorAction Stop } catch { exit 2 }
              try {
                PSReadLine\Set-PSReadLineOption -HistorySaveStyle SaveNothing -ErrorAction Stop
                if ((PSReadLine\Get-PSReadLineOption).HistorySaveStyle -ne 'SaveNothing') { exit 2 }
              } catch { exit 2 }
              try {
                PSReadLine\Set-PSReadLineOption -Colors @{ Command='Cyan'; Comment='DarkGray'; Keyword='Magenta'; String='Green'; Variable='Cyan'; Number='Yellow'; Operator='White'; Parameter='Blue'; Type='Yellow' } -ErrorAction Stop
              } catch { }
            }
          }";
          // The shell is a fixed ID resolved above, never a caller-supplied
          // executable or command. CMD receives no PowerShell bootstrap.
          string arguments;
          if (shellId == "local:cmd") {
            arguments = " /d"; // Disable HKLM/HKCU Command Processor AutoRun.
            Environment.SetEnvironmentVariable("PROMPT", "$P$G", EnvironmentVariableTarget.Process);
          } else arguments = " -NoExit -NoLogo -NoProfile -EncodedCommand " + Convert.ToBase64String(Encoding.Unicode.GetBytes(syntax));
          if (!CreateProcess(executable, new StringBuilder("\"" + executable + "\"" + arguments), IntPtr.Zero, IntPtr.Zero,
            false, EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED, IntPtr.Zero, home, ref startup, out info))
            throw new Win32Exception(Marshal.GetLastWin32Error());
          process = info.hProcess; thread = info.hThread;
          CloseHandle(inputRead); inputRead = IntPtr.Zero;
          CloseHandle(outputWrite); outputWrite = IntPtr.Zero;
          job = CreateJobObject(IntPtr.Zero, null);
          if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
          JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
          limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
          int len = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
          IntPtr ptr = Marshal.AllocHGlobal(len);
          try {
            Marshal.StructureToPtr(limits, ptr, false);
            if (!SetInformationJobObject(job, 9, ptr, (uint)len) || !AssignProcessToJobObject(job, process))
              throw new Win32Exception(Marshal.GetLastWin32Error());
          } finally { Marshal.FreeHGlobal(ptr); }
          assigned = true;
          if (ResumeThread(thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
          hr = provider.Release(hpc);
          if (hr < 0) Marshal.ThrowExceptionForHR(hr);
          inputHandle = inputWrite; inputWrite = IntPtr.Zero;
          outputHandle = outputRead; outputRead = IntPtr.Zero;
        } catch {
          if (process != IntPtr.Zero && !assigned) TerminateProcess(process, 1);
          if (inputRead != IntPtr.Zero) { CloseHandle(inputRead); inputRead = IntPtr.Zero; }
          if (inputWrite != IntPtr.Zero) { CloseHandle(inputWrite); inputWrite = IntPtr.Zero; }
          if (outputRead != IntPtr.Zero) { CloseHandle(outputRead); outputRead = IntPtr.Zero; }
          if (outputWrite != IntPtr.Zero) { CloseHandle(outputWrite); outputWrite = IntPtr.Zero; }
          Dispose(); throw;
        }
        finally {
          if (inputRead != IntPtr.Zero) CloseHandle(inputRead);
          if (inputWrite != IntPtr.Zero) CloseHandle(inputWrite);
          if (outputRead != IntPtr.Zero) CloseHandle(outputRead);
          if (outputWrite != IntPtr.Zero) CloseHandle(outputWrite);
          if (thread != IntPtr.Zero) CloseHandle(thread);
          if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
        }
      }
      public void Resize(short cols, short rows) {
        lock (consoleLock) {
          if (hpc == IntPtr.Zero) throw new IOException("Administrator console has ended");
          COORD size = new COORD { X = cols, Y = rows };
          int hr = provider.Resize(hpc, size);
          if (hr < 0) Marshal.ThrowExceptionForHR(hr);
        }
      }
      public int ReadOutput(byte[] block) {
        uint count;
        if (!ReadFile(outputHandle, block, 1, out count, IntPtr.Zero)) {
          int error = Marshal.GetLastWin32Error();
          if (error == 109 || error == 232 || error == 6) return 0;
          throw new Win32Exception(error);
        }
        uint available;
        if (count > 0 && PeekNamedPipe(outputHandle, IntPtr.Zero, 0, IntPtr.Zero, out available, IntPtr.Zero) && available > 0) {
          byte[] rest = new byte[Math.Min((int)available, block.Length - 1)];
          uint extra;
          if (ReadFile(outputHandle, rest, (uint)rest.Length, out extra, IntPtr.Zero)) {
            Buffer.BlockCopy(rest, 0, block, (int)count, (int)extra);
            count += extra;
          }
        }
        return (int)count;
      }
      public void WriteInput(byte[] data) {
        int offset = 0;
        while (offset < data.Length) {
          byte[] chunk = new byte[data.Length - offset];
          Buffer.BlockCopy(data, offset, chunk, 0, chunk.Length);
          uint written;
          if (!WriteFile(inputHandle, chunk, (uint)chunk.Length, out written, IntPtr.Zero) || written == 0)
            throw new Win32Exception(Marshal.GetLastWin32Error());
          offset += (int)written;
        }
      }
      public void WaitForExit() { if (process != IntPtr.Zero) WaitForSingleObject(process, 0xFFFFFFFF); }
      public void CloseConsole() {
        lock (consoleLock) {
          if (hpc != IntPtr.Zero) { IntPtr current = hpc; hpc = IntPtr.Zero; provider.Close(current); }
        }
      }
      public void CloseInput() {
        IntPtr current = Interlocked.Exchange(ref inputHandle, IntPtr.Zero);
        if (current != IntPtr.Zero) CloseHandle(current);
      }
      public void Stop() {
        CloseInput();
        IntPtr current = Interlocked.Exchange(ref job, IntPtr.Zero);
        if (current != IntPtr.Zero) CloseHandle(current);
      }
      public void Dispose() {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        Stop();
        CloseConsole();
        if (outputHandle != IntPtr.Zero) { CloseHandle(outputHandle); outputHandle = IntPtr.Zero; }
        if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
        if (provider != null) { provider.Dispose(); provider = null; }
      }
    }

    [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public int bInheritHandle; }
    [StructLayout(LayoutKind.Sequential)] struct COORD { public short X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct BY_HANDLE_FILE_INFORMATION {
      public uint FileAttributes;
      public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime, LastAccessTime, LastWriteTime;
      public uint VolumeSerialNumber, FileSizeHigh, FileSizeLow, NumberOfLinks, FileIndexHigh, FileIndexLow;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
      public int cb; public string lpReserved, lpDesktop, lpTitle; public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
      public short wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }
    [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }
    [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint dwProcessId, dwThreadId; }
    [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount; }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
      public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public IntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
      public uint ActiveProcessLimit; public IntPtr Affinity; public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)] struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
      public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation; public IO_COUNTERS IoInfo;
      public IntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint revision, out IntPtr descriptor, IntPtr size);
    [DllImport("kernel32.dll")] static extern IntPtr LocalFree(IntPtr ptr);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateNamedPipe(string name, uint openMode, uint pipeMode, uint maxInstances, uint outBuffer, uint inBuffer, uint timeout, ref SECURITY_ATTRIBUTES security);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeClientProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetNamedPipeServerProcessId(IntPtr pipe, out uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, IntPtr security, int size);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr OpenNativeFile(string name, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateNativeFile(string name, uint access, uint share, ref SECURITY_ATTRIBUTES security, uint creation, uint flags, IntPtr template);
    [DllImport("kernel32.dll", EntryPoint = "CreateDirectoryW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateNativeDirectory(string name, ref SECURITY_ATTRIBUTES security);
    [DllImport("kernel32.dll", EntryPoint = "DeleteFileW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool DeleteNativeFile(string name);
    [DllImport("kernel32.dll", EntryPoint = "RemoveDirectoryW", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool RemoveNativeDirectory(string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint GetFileType(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetFileInformationByHandle(IntPtr handle, out BY_HANDLE_FILE_INFORMATION info);
    [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW", SetLastError = true, CharSet = CharSet.Unicode)] static extern uint GetFinalPathNameByHandle(IntPtr handle, StringBuilder path, uint length, uint flags);
    [DllImport("advapi32.dll", SetLastError = true)] static extern uint GetSecurityInfo(IntPtr handle, uint type, uint information, out IntPtr owner, out IntPtr group, out IntPtr dacl, out IntPtr sacl, out IntPtr descriptor);
    [DllImport("advapi32.dll")] static extern uint GetSecurityDescriptorLength(IntPtr descriptor);
    [DllImport("kernel32.dll", EntryPoint = "LoadLibraryExW", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr LoadLibraryEx(string name, IntPtr file, uint flags);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true)] static extern IntPtr GetProcAddress(IntPtr module, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool FreeLibrary(IntPtr module);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref STARTUPINFOEX startup, out PROCESS_INFORMATION info);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);
    [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetTokenInformation(IntPtr token, int infoClass, byte[] buffer, int length, out int returned);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr handle, uint code);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool ReadFile(IntPtr handle, byte[] buffer, uint length, out uint read, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool WriteFile(IntPtr handle, byte[] buffer, uint length, out uint written, IntPtr overlapped);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool PeekNamedPipe(IntPtr handle, IntPtr buffer, uint bufferSize, IntPtr bytesRead, out uint bytesAvailable, IntPtr bytesLeft);
  }
}
