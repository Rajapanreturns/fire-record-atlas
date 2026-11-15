# Fire Record Atlas: public release. Python 3.9+ and Node 18+ (Node only for tests).
PY   ?= python3
PORT ?= 8000

.PHONY: serve test validate build clean

serve:            ## run the site locally at http://localhost:$(PORT)/
	$(PY) scripts/serve.py --port $(PORT) --bind 127.0.0.1 --dir site

test:             ## site unit tests, then data checks
	node --test tests/site/*.mjs
	$(PY) contracts/validate.py site/data --production --public

validate:         ## check the published data files against their schemas
	$(PY) contracts/validate.py site/data --production --public

build:            ## copy the static site to dist/ (without the test fixtures) and check it
	rm -rf dist && mkdir -p dist
	cd site && tar --exclude ./data-fixtures -cf - . | (cd ../dist && tar -xf -)
	@if [ -e dist/data-fixtures ]; then echo "ERROR: fixtures leaked into dist/"; exit 1; fi
	$(PY) contracts/validate.py dist/data --production --public
	@echo "Build OK: dist/ is the static site."

clean:
	rm -rf dist
