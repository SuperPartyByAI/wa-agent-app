import paramiko
client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
try:
    print("Python connecting...", flush=True)
    client.connect('91.98.16.90', username='root', password='9vAxpqRLv7bF', timeout=10)
    print("Connected successfully!", flush=True)
    stdin, stdout, stderr = client.exec_command('ls -l /tmp/install.log')
    print("STDOUT:", stdout.read().decode())
    print("STDERR:", stderr.read().decode())
    stdin, stdout, stderr = client.exec_command('cat /tmp/install.log')
    print("LOG_TAIL:", stdout.read().decode()[-1000:])
except Exception as e:
    print("Python Exception:", str(e), flush=True)
finally:
    client.close()
