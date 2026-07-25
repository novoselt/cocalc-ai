/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const OPEN_TERMINAL_BODY = String.raw`
## What CoCalc terminals are for

CoCalc terminals are real terminals running in your project Linux environment.
They use xterm.js in the browser, but the process state lives on the backend:
you can start a command, close the browser tab, and come back to the same
running terminal.

## Open a terminal

1. Open the project.
2. Open the file browser or the activity bar.
3. Choose **Terminal** or create a file ending in \`.term\`.
4. Run normal shell commands.

Terminal files are intentionally path-based. Opening \`work/analysis.term\`
starts in \`work/\`, and the terminal session has a stable file anchor that
humans and agents can refer to.

## Agent and CLI access

Codex can inspect and drive live terminal sessions through the browser-session
API. For persistent terminal work from an agent, prefer the typed terminal APIs
over screenshot automation when possible.

## Why this matters in CoCalc

A CoCalc terminal is collaborative, durable, and attached to project files. It is
not just a temporary browser shell: it is part of a shared computational
workspace with side chat, project storage, TimeTravel-friendly files, and direct
SSH access when you want native tools.
`;

export const USE_TERMINAL_BODY = String.raw`
## What CoCalc terminals are for

CoCalc terminals are persistent Linux shell sessions inside a project. The
terminal UI runs in the browser, but the shell process runs in the project
backend, so commands can keep running while the browser disconnects.

Use terminals to install packages, run scripts, inspect files, start services,
use Git, manage virtual environments, and work with command-line tools that are
part of the project environment.

## Open and organize terminals

Open a terminal from the project activity bar, the file browser, or by opening a
file ending in \`.term\`. For the short action flow, see
[Open a terminal](/docs/projects/open-terminal).

Terminal files are path-based. A terminal at \`analysis/run.term\` starts in the
\`analysis/\` directory and gives the session a stable project-file anchor.
Create separate terminal files for separate tasks when that makes the workspace
easier to understand.

## Open project files from the terminal

Use the \`open\` command to open files and directories in CoCalc from the shell,
similar to \`xdg-open\` on Linux or \`open\` on macOS:

~~~sh
open path/to/file.ipynb path/to/script.py path/to/folder
~~~

This is often faster than switching to the file browser when you are already
working in a terminal. Paths are interpreted relative to the terminal's current
directory.

## Persistent work

Browser tabs are not the process boundary. Long commands can continue after the
browser disconnects, and collaborators can reconnect to the same terminal later.
For very long or fragile jobs, use standard shell tools such as \`tmux\`, log
files, or scripts so progress is visible and restartable.

## Collaboration and safety

Terminals are collaborative. People with access to the running project can see
terminal content and may be able to interact with the shell. Avoid pasting
secrets into commands, prompts, logs, or shell history. Use
[project secrets](/docs/projects/project-secrets) for credentials consumed by
project code.

## Agents and automation

Agents should prefer typed CoCalc terminal or browser-session APIs when they
need to inspect or drive a live terminal. Use the terminal for real shell work,
but avoid relying on screenshot-only automation when a CLI or project API can
perform the same operation directly.

## Troubleshooting

If a terminal seems unresponsive, check whether the project is running and
whether a command is still active. Use Ctrl-C for a foreground command, open a
new terminal for independent diagnosis, and inspect project memory if commands
are being killed.
`;

export const SSH_ACCESS_BODY = String.raw`
## SSH access on cocalc.ai

SSH gives command-line tools on your computer direct access to a CoCalc
project. You can run remote commands and use standard tools such as \`ssh\`,
\`scp\`, \`sftp\`, and \`rsync\`.

The legacy \`ssh.cocalc.com\` gateway belongs to the previous cocalc.com
architecture. Commands such as
\`ssh PROJECT_ID_WITHOUT_DASHES@ssh.cocalc.com\` do not connect to cocalc.ai
projects. Each cocalc.ai project instead receives a managed SSH route, which
the CoCalc CLI writes into your local \`~/.ssh/config\`.

## Connect from your computer

Open **Project Settings → SSH** in the target project. The panel shows commands
for the current site and project.

Install the CoCalc CLI once:

~~~sh
curl -fsSL https://software.cocalc.ai/software/cocalc/install.sh | bash
~~~

Configure the project, replacing the example project id:

~~~sh
cocalc --api https://cocalc.ai project ssh-config add \
  -w 00000000-0000-4000-8000-000000000000
~~~

When run in an interactive terminal, the CLI starts browser login automatically
if you have not signed in yet. Approve that login in your browser. The command
then:

1. creates or reuses \`~/.ssh/id_ed25519\`;
2. installs its public key in the target project;
3. installs the Cloudflare SSH transport helper when needed; and
4. writes a managed host entry to \`~/.ssh/config\`.

Connect using the project id as the host alias:

~~~sh
ssh 00000000-0000-4000-8000-000000000000
~~~

The key and SSH config remain usable after CLI login expires. The account
session is needed for setup, not for each SSH connection.

## Copy files

After setup, file-transfer tools use the same host alias:

~~~sh
scp ./local-file 00000000-0000-4000-8000-000000000000:~/
scp 00000000-0000-4000-8000-000000000000:~/remote-file ./
rsync -a ./local-directory/ \
  00000000-0000-4000-8000-000000000000:~/remote-directory/
~~~

\`rsync\` must be installed at both ends. If \`scp\` or \`sftp\` reports a
missing SFTP server, install \`openssh-sftp-server\` in the project image.

## Connect from one CoCalc project to another

Do not run \`cocalc auth login\` inside a collaborative project. That would
store a broad, long-lived account session in a filesystem shared with the
project's collaborators.

Instead:

1. Open **Project Settings → SSH** in the target project.
2. Choose **Configure project-to-project SSH**.
3. Select the source project that will initiate connections.
4. Confirm the operation with fresh authentication.
5. In a terminal in the source project, run \`ssh TARGET_PROJECT_ID\`.

CoCalc reuses \`~/.ssh/id_ed25519\` when the source already has one. Otherwise,
it creates a new deploy key and stores its private key as the encrypted
\`SSH_PRIVATE_KEY\` project secret. It authorizes only the public key on the
target and writes the route in the source project. Your CoCalc account session
is never stored in either project.

Everyone with filesystem access to the source project can use its deploy key.
Only select a source whose collaborators should receive access to the target.
To revoke access, delete the corresponding project SSH key from the target
project's SSH settings.

## Automated course setup

If a script in the project containing a \`.course\` file must connect to every
student project:

1. Open the \`.course\` file and select **Configuration**.
2. Find **SSH to course projects**.
3. Check **Allow this course project to SSH to every student project and the
   shared project**.
4. Complete the fresh-authentication prompt.

CoCalc creates one deploy key in the course project, authorizes it in every
active student project and the shared project, and writes a managed SSH entry
for each target. A deployment script can then use a project id directly:

~~~sh
ssh STUDENT_PROJECT_ID 'python3 ~/setup.py'
rsync -a ./course-environment/ STUDENT_PROJECT_ID:~/course-environment/
~~~

The CoCalc CLI is already installed inside CoCalc projects, but this course
workflow does not run \`cocalc auth login\` and does not store an instructor's
account session in the collaborative course project.

Use **Synchronize SSH access** after adding or restoring student projects, or
after a target project moves to another host or region. CoCalc also attempts to
configure newly created student and shared projects automatically. If that
attempt happens after fresh authentication has expired, project creation still
succeeds; open Course Configuration and synchronize SSH access again.

Unchecking the option removes the managed public key from all known student
projects and the shared project, and removes their managed SSH config entries.
The deploy key itself remains in the course project so it can be reused if the
option is enabled again.

Everyone with filesystem access to the course project can use this key and thus
receives full shell access to every configured target. Only enable the option
when every course project collaborator should have that access.

The course manager who enables the option owns the project-specific public-key
entries and must also synchronize or disable them. This guard prevents a second
manager from accidentally leaving the original manager's key authorized.

## Troubleshooting

- If the first connection starts a stopped project but does not immediately
  open a shell, wait a moment and run the same command again.
- Run \`ssh -v PROJECT_ID\` to see which host, key, and proxy command OpenSSH is
  using.
- Re-run \`cocalc project ssh-config add -w PROJECT_ID\` after a project moves
  to another host or region.
- Check that the private key named by \`IdentityFile\` exists and that the
  matching public key remains listed in the target project's SSH settings.
- SSH access is full shell access to the project. Treat private keys and source
  projects accordingly.
`;
