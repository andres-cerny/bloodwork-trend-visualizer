# samples/

Drop your Czech lab-report PDFs here.

They are git-ignored (`samples/*.pdf`) and a commit hook refuses to stage them —
this is real medical data and the one hard rule is that it never leaves the
machine. Only this README is tracked, so the folder exists in a fresh clone.

The web app reads uploads in the browser and never writes them anywhere. To
process them with the local pipeline instead:

```sh
cd tools/pipeline
python3 -m scripts.export_web_data --help
```

Note the extraction pipeline itself is archived (`tools/archive/`) — the Workers
do that job now.
