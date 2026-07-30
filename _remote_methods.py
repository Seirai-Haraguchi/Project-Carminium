def add_remote_methods():
  with open("electron/library.js","r",encoding="utf-8") as f: c=f.read()
  code = """
