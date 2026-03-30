install:
	npm install
	npm --prefix tests/visual install

generate-design:
	node scripts/generate-ui-kit.mjs

mobile-dev:
	npm run dev

mobile-web:
	npm run web

mobile-typecheck:
	npm run typecheck

visual-test:
	npm --prefix tests/visual run test

build-qr:
	npx eas build --profile preview --platform all

testflight:
	npx eas submit --platform ios --profile production

pgyer:
	powershell -ExecutionPolicy Bypass -Command "Invoke-RestMethod -Method Post -Uri https://www.pgyer.com/apiv2/app/upload -Form @{ _api_key = $$env:PGYER_API_KEY; buildInstallType = '2'; file = Get-Item './dist/app-release.apk' }"

ota-preview:
	npx eas update --channel preview --message "preview update"
