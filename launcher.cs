using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
using System.Reflection;

class PPELauncher
{
    static Process serverProcess;
    static NotifyIcon trayIcon;
    static int PORT = 3456;
    static string appDir;

    [STAThread]
    static void Main()
    {
        appDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);

        // Check Node.js
        if (!IsNodeInstalled())
        {
            MessageBox.Show(
                "Node.js is not installed!\n\nDownload from: https://nodejs.org/",
                "TAASCOR PPE Inventory", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // If already running, just open browser
        if (IsPortInUse(PORT))
        {
            OpenBrowser();
            return;
        }

        // Ensure firewall rule exists for network access
        EnsureFirewallRule();

        // Install deps if needed
        if (!Directory.Exists(Path.Combine(appDir, "node_modules")))
        {
            MessageBox.Show("First-time setup: Installing dependencies.\nClick OK and please wait...",
                "TAASCOR PPE Inventory", MessageBoxButtons.OK, MessageBoxIcon.Information);
            RunCmd("npm install --production");
        }

        // Start server
        serverProcess = new Process();
        serverProcess.StartInfo.FileName = "node";
        serverProcess.StartInfo.Arguments = "server.js";
        serverProcess.StartInfo.WorkingDirectory = appDir;
        serverProcess.StartInfo.UseShellExecute = false;
        serverProcess.StartInfo.CreateNoWindow = true;
        serverProcess.StartInfo.RedirectStandardOutput = true;
        serverProcess.StartInfo.RedirectStandardError = true;

        try
        {
            serverProcess.Start();
        }
        catch (Exception ex)
        {
            MessageBox.Show("Failed to start server:\n" + ex.Message,
                "TAASCOR PPE Inventory", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        // Wait for server then open browser
        Thread t = new Thread(WaitAndOpenBrowser);
        t.IsBackground = true;
        t.Start();

        // Setup tray icon
        Application.EnableVisualStyles();
        SetupTray();
        Application.Run();
    }

    static void WaitAndOpenBrowser()
    {
        for (int i = 0; i < 40; i++)
        {
            Thread.Sleep(300);
            if (IsPortInUse(PORT))
            {
                Thread.Sleep(500);
                OpenBrowser();
                return;
            }
        }
        MessageBox.Show("Server did not start in time.\nPlease try again.",
            "TAASCOR PPE Inventory", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        ExitApp();
    }

    static void SetupTray()
    {
        trayIcon = new NotifyIcon();
        trayIcon.Text = "TAASCOR PPE Inventory (Running)";
        trayIcon.Visible = true;

        Bitmap bmp = new Bitmap(16, 16);
        Graphics g = Graphics.FromImage(bmp);
        g.Clear(Color.FromArgb(26, 58, 107));
        g.FillRectangle(Brushes.White, 3, 3, 10, 10);
        g.FillRectangle(new SolidBrush(Color.FromArgb(196, 18, 48)), 5, 5, 6, 6);
        g.Dispose();
        trayIcon.Icon = Icon.FromHandle(bmp.GetHicon());

        ContextMenu menu = new ContextMenu();
        menu.MenuItems.Add("Open PPE Inventory", delegate { OpenBrowser(); });
        menu.MenuItems.Add("-");
        menu.MenuItems.Add("Exit / Stop Server", delegate { ExitApp(); });
        trayIcon.ContextMenu = menu;
        trayIcon.DoubleClick += delegate { OpenBrowser(); };
    }

    static void OpenBrowser()
    {
        try
        {
            Process.Start(new ProcessStartInfo("http://localhost:" + PORT) { UseShellExecute = true });
        }
        catch
        {
            Process.Start("cmd", "/c start http://localhost:" + PORT);
        }
    }

    static void ExitApp()
    {
        try
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                serverProcess.Kill();
            }
        }
        catch {}

        if (trayIcon != null)
        {
            trayIcon.Visible = false;
            trayIcon.Dispose();
        }
        Environment.Exit(0);
    }

    static bool IsNodeInstalled()
    {
        try
        {
            Process p = new Process();
            p.StartInfo.FileName = "node";
            p.StartInfo.Arguments = "--version";
            p.StartInfo.UseShellExecute = false;
            p.StartInfo.CreateNoWindow = true;
            p.StartInfo.RedirectStandardOutput = true;
            p.Start();
            p.WaitForExit(5000);
            return p.ExitCode == 0;
        }
        catch { return false; }
    }

    static bool IsPortInUse(int port)
    {
        try
        {
            TcpClient client = new TcpClient();
            IAsyncResult result = client.BeginConnect("127.0.0.1", port, null, null);
            bool success = result.AsyncWaitHandle.WaitOne(300);
            if (success)
            {
                client.EndConnect(result);
                client.Close();
                return true;
            }
            client.Close();
            return false;
        }
        catch { return false; }
    }

    static void RunCmd(string args)
    {
        Process p = new Process();
        p.StartInfo.FileName = "cmd.exe";
        p.StartInfo.Arguments = "/c " + args;
        p.StartInfo.WorkingDirectory = appDir;
        p.StartInfo.UseShellExecute = false;
        p.StartInfo.CreateNoWindow = true;
        p.Start();
        p.WaitForExit();
    }

    static void EnsureFirewallRule()
    {
        try
        {
            // Check if rule already exists
            Process check = new Process();
            check.StartInfo.FileName = "netsh";
            check.StartInfo.Arguments = "advfirewall firewall show rule name=\"TAASCOR PPE Inventory\"";
            check.StartInfo.UseShellExecute = false;
            check.StartInfo.CreateNoWindow = true;
            check.StartInfo.RedirectStandardOutput = true;
            check.Start();
            string output = check.StandardOutput.ReadToEnd();
            check.WaitForExit(5000);

            if (check.ExitCode != 0 || !output.Contains("TAASCOR PPE Inventory"))
            {
                // Add the firewall rule (requires elevation)
                Process add = new Process();
                add.StartInfo.FileName = "netsh";
                add.StartInfo.Arguments = "advfirewall firewall add rule name=\"TAASCOR PPE Inventory\" dir=in action=allow protocol=TCP localport=" + PORT;
                add.StartInfo.Verb = "runas";
                add.StartInfo.UseShellExecute = true;
                add.StartInfo.CreateNoWindow = true;
                add.Start();
                add.WaitForExit(10000);
            }
        }
        catch {} // Silently continue if firewall rule can't be added
    }
}
