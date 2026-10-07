#!/usr/bin/env bash
# Hermetic loopback-only service for CI; never targets a user's SSH server.
set -euo pipefail
root="${RUNNER_TEMP:-/tmp}/nerdsshell-ci-sshd"
mkdir -p "$root"
chmod 700 "$root"
ssh-keygen -q -t ed25519 -N '' -f "$root/client"
ssh-keygen -q -t ed25519 -N '' -f "$root/host"
ssh-keygen -q -t ed25519 -N '' -f "$root/host2"
cat > "$root/sshd_config" <<CONF
Port 22222
ListenAddress 127.0.0.1
HostKey $root/host
PidFile $root/sshd.pid
AuthorizedKeysFile $root/client.pub
AllowUsers $(id -un)
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
UsePAM yes
StrictModes no
MaxSessions 20
Subsystem sftp internal-sftp
CONF
cat > "$root/sshd_config2" <<CONF
Port 22223
ListenAddress 127.0.0.1
HostKey $root/host2
PidFile $root/sshd2.pid
AuthorizedKeysFile $root/client.pub
AllowUsers $(id -un)
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
PermitRootLogin no
UsePAM yes
StrictModes no
MaxSessions 20
Subsystem sftp internal-sftp
CONF
sudo mkdir -p /run/sshd
sudo /usr/sbin/sshd -f "$root/sshd_config" -E "$root/sshd.log"
sudo /usr/sbin/sshd -f "$root/sshd_config2" -E "$root/sshd2.log"
printf '[127.0.0.1]:22222 %s\n' "$(awk '{print $1 " " $2}' "$root/host.pub")" > "$root/known_hosts"
if ! ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$root/known_hosts" -o StrictHostKeyChecking=yes \
  -p 22222 -i "$root/client" "$(id -un)@127.0.0.1" true; then
  echo 'Disposable SSH fixture rejected its own test key:' >&2
  sudo tail -n 30 "$root/sshd.log" >&2
  exit 1
fi
printf '[127.0.0.1]:22223 %s\n' "$(awk '{print $1 " " $2}' "$root/host2.pub")" > "$root/known_hosts2"
if ! ssh -F /dev/null -o BatchMode=yes -o IdentitiesOnly=yes \
  -o UserKnownHostsFile="$root/known_hosts2" -o StrictHostKeyChecking=yes \
  -p 22223 -i "$root/client" "$(id -un)@127.0.0.1" true; then
  echo 'Second disposable SSH fixture rejected its own test key:' >&2
  sudo tail -n 30 "$root/sshd2.log" >&2
  exit 1
fi
{
  echo 'NERDSSHELL_TEST_HOST=127.0.0.1'
  echo 'NERDSSHELL_TEST_PORT=22222'
  echo "NERDSSHELL_TEST_USER=$(id -un)"
  echo "NERDSSHELL_TEST_KEY=$root/client"
  echo "NERDSSHELL_TEST_HOST_KEY=$root/host"
  echo 'NERDSSHELL_TEST_PORT_2=22223'
  echo "NERDSSHELL_TEST_HOST_KEY_2=$root/host2"
} >> "$GITHUB_ENV"
