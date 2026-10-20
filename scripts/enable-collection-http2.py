"""Enable HTTP/2 only for this app's existing TLS virtual host; dry-run by default."""
import argparse
import json
import pathlib
import re
import shutil
import subprocess
import time

HOST = "aisearchfilter.webvory.com"


def updated_config(text):
    names = re.findall(r"(?m)^\s*server_name\s+([^;]+);", text)
    if not names or any(set(name.split()) != {HOST} for name in names):
        raise ValueError("Configuration contains an unexpected virtual host")
    if re.search(r"(?m)^\s*http2\s+on\s*;", text) or re.search(r"listen[^;]*443[^;]*\bhttp2\b", text):
        return text
    pattern = r"(?m)^(\s*)listen\s+(?:\[::\]:)?443\s+ssl[^;]*;[^\n]*$"
    result, count = re.subn(pattern, lambda m: m.group(0) + "\n" + m.group(1) + "http2 on;", text, count=1)
    if count != 1:
        raise ValueError("Expected an existing app TLS listener")
    return result


def self_test():
    original = "server {\n server_name " + HOST + ";\n listen 443 ssl; # managed by Certbot\n}\nserver {\n server_name " + HOST + ";\n listen 80;\n}\n"
    changed = updated_config(original)
    assert changed.count("http2 on;") == 1
    assert updated_config(changed) == changed
    assert "listen 80;" in changed
    for bad in [original.replace(HOST, "other.example"), original.replace("listen 443 ssl;", "listen 8443 ssl;")]:
        try:
            updated_config(bad)
        except ValueError:
            pass
        else:
            raise AssertionError("Unsafe host/listener accepted")
    print("HTTP2 configuration self-tests passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    version = subprocess.check_output(["nginx", "-V"], stderr=subprocess.STDOUT, text=True)
    if "--with-http_v2_module" not in version:
        raise RuntimeError("Installed nginx has no HTTP/2 module")
    match = re.search(r"nginx/(\d+)\.(\d+)", version)
    if not match or tuple(map(int, match.groups())) < (1, 25):
        raise RuntimeError("This helper requires nginx 1.25+ http2 directive")
    path = pathlib.Path("/etc/nginx/sites-enabled/" + HOST).resolve(strict=True)
    if not path.is_relative_to(pathlib.Path("/etc/nginx")):
        raise RuntimeError("Unexpected nginx configuration target")
    original = path.read_text()
    changed = updated_config(original)
    subprocess.run(["nginx", "-t"], check=True)
    if not args.apply or changed == original:
        print(json.dumps({"apply": args.apply, "changeRequired": changed != original, "path": str(path)}))
        return
    backup_dir = pathlib.Path("/var/backups/cfp-nginx")
    backup_dir.mkdir(parents=True, exist_ok=True)
    backup = backup_dir / (path.name + "." + str(time.time_ns()))
    shutil.copy2(path, backup)
    try:
        path.write_text(changed)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
    except BaseException:
        shutil.copy2(backup, path)
        subprocess.run(["nginx", "-t"], check=True)
        subprocess.run(["systemctl", "reload", "nginx"], check=True)
        raise
    print(json.dumps({"applied": True, "path": str(path), "backup": str(backup)}))


if __name__ == "__main__":
    main()
