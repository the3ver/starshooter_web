import subprocess

output = subprocess.check_output(['git', 'show', '9f7221ea89368ba5545e36e1e3615fddbf590f36:index.html'], text=True)

with open('scratch_git_index.html', 'w', encoding='utf-8') as f:
    f.write(output)
