#!/usr/bin/env bash
# ============================================================
# 冷库设备档案 - 端到端部署验证
# 用法: npm run verify   (默认 http://localhost:3000)
# ============================================================
set -uo pipefail
BASE="${BASE:-http://localhost:3000}"
PASS=0; FAIL=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
check(){ if eval "$2"; then ok "$1"; else bad "$1"; fi; }
jqget(){ sed -n 's/.*"'"$2"'":"*\([^",}]*\)"*.*/\1/p' "$1" | head -1; }

login(){ curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
        -d "{\"username\":\"${1:-}\",\"password\":\"${2:-}\"}"; }
auth_get(){ curl -s -H "Authorization: Bearer ${1:-}" "$BASE/api${2:-}"; }
code_get(){ curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer ${1:-}" "$BASE/api${2:-}"; }

echo "━━━━━━━━━━ 1. 基础部署 ━━━━━━━━━━"
check "首页可访问"            "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/)\" = 200 ]"
check "前端资源 app.js 200"   "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/app.js)\" = 200 ]"
check "未知前端路径回退 SPA"  "[ \"\$(curl -s -o /dev/null -w '%{http_code}' $BASE/some/route)\" = 200 ]"
check "登录错误密码被拒(401)" "[ \"\$(curl -s -o /dev/null -w '%{http_code}' -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"wrong\"}')\" = 401 ]"
check "无令牌访问 API 被拒(401)" "[ \"$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/equipment)\" = 401 ]"

echo "━━━━━━━━━━ 2. 三角色登录与权限 ━━━━━━━━━━"
login admin   Admin@123   > "$TMP/admin.json"
login manager Manager@123 > "$TMP/mgr.json"
login viewer  Viewer@123  > "$TMP/view.json"
AT=$(jqget "$TMP/admin.json" token); MT=$(jqget "$TMP/mgr.json" token); VT=$(jqget "$TMP/view.json" token)
check "admin 登录拿到令牌"   "[ -n \"$AT\" ]"
check "manager 登录拿到令牌" "[ -n \"$MT\" ]"
check "viewer 登录拿到令牌"  "[ -n \"$VT\" ]"

auth_get "$AT" /auth/me > "$TMP/me.json"
check "admin 权限含 equipment:delete" "grep -q equipment:delete '$TMP/me.json'"
check "admin 菜单含用户管理"          "grep -q 用户与权限 '$TMP/me.json'"
auth_get "$MT" /auth/me > "$TMP/mme.json"
check "主管无删除权限"      "! grep -q equipment:delete '$TMP/mme.json'"
check "主管有上传权限"      "grep -q document:upload '$TMP/mme.json'"
check "主管菜单无用户管理"  "! grep -q menu:users '$TMP/mme.json'"
auth_get "$VT" /auth/me > "$TMP/vme.json"
check "只读用户无写权限"    "! grep -q equipment:write '$TMP/vme.json'"
check "只读用户仅看到2个菜单" "[ \$(grep -o '\"path\"' '$TMP/vme.json' | wc -l) -eq 2 ]"
check "viewer 访问用户管理 403" "[ \"\$(code_get $VT /users)\" = 403 ]"
check "viewer 访问温区字典 200" "[ \"\$(code_get $VT /dict/zones)\" = 200 ]"

echo "━━━━━━━━━━ 3. 设备列表与筛选 ━━━━━━━━━━"
auth_get "$AT" /equipment > "$TMP/list.json"
TOTAL=$(jqget "$TMP/list.json" total)
check "种子设备数=6" "[ \"$TOTAL\" = 6 ]"
auth_get "$AT" '/equipment?zone=L' > "$TMP/z.json"
check "按温区L筛选=2台" "[ \"$(jqget "$TMP/z.json" total)\" = 2 ]"
auth_get "$AT" '/equipment?status=fault' > "$TMP/s.json"
check "按状态fault筛选=1台" "[ \"$(jqget "$TMP/s.json" total)\" = 1 ]"
auth_get "$AT" '/equipment?zone=L&status=running' > "$TMP/zs.json"
check "温区+状态组合筛选=1台" "[ \"$(jqget "$TMP/zs.json" total)\" = 1 ]"
auth_get "$AT" "/equipment?q=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("王伟"))')" > "$TMP/q.json"
check "关键字(负责人)筛选=2台" "[ \"$(jqget "$TMP/q.json" total)\" = 2 ]"
check "非法温区参数被忽略(仍返回6)" "[ \"$(auth_get "$AT" '/equipment?zone=BAD' | jqget - total)\" = 6 ]"

echo "━━━━━━━━━━ 4. 新增 / 编辑 / 删除 ━━━━━━━━━━"
NEWID=$(curl -s -X POST "$BASE/api/equipment" -H "Authorization: Bearer $AT" \
  -H 'Content-Type: application/json' \
  -d '{"code":"CS-TEST-9","name":"验证测试机组","zone_code":"H","location":"测试机房","owner":"测试员","last_maintenance_date":"2026-09-01","status":"running"}' \
  | jqget - id)
check "admin 新增设备成功" "[ -n \"$NEWID\" ]"
check "重复编号 409" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/equipment" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"code":"CS-TEST-9","name":"x","zone_code":"H","location":"x","owner":"x"}')\" = 409 ]"
check "缺字段 400" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/equipment" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"code":"X1"}')\" = 400 ]"
check "viewer 新增被拒 403" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/equipment" -H "Authorization: Bearer $VT" -H 'Content-Type: application/json' -d '{"code":"CS-X1","name":"x","zone_code":"H","location":"x","owner":"x"}')\" = 403 ]"
curl -s -X PUT "$BASE/api/equipment/$NEWID" -H "Authorization: Bearer $MT" \
  -H 'Content-Type: application/json' -d '{"status":"maintenance","owner":"主管接管"}' > /dev/null
check "manager 可编辑设备" "grep -q 主管接管 <(auth_get "$AT" /equipment/$NEWID)"
check "viewer 删除被拒 403" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/equipment/$NEWID" -H "Authorization: Bearer $VT")\" = 403 ]"
check "篡改令牌被拒 401" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ${AT}xx' "$BASE/api/equipment")\" = 401 ]"

echo "━━━━━━━━━━ 5. 说明书上传 / 下载 / 删除 ━━━━━━━━━━"
echo '%PDF-1.4 fake pdf for verify' > "$TMP/manual.pdf"
UP=$(curl -s -X POST "$BASE/api/equipment/$NEWID/documents" \
  -H "Authorization: Bearer $MT" -F "file=@$TMP/manual.pdf;type=application/pdf")
DOCID=$(echo "$UP" | jqget - id)
check "主管上传说明书成功" "[ -n \"$DOCID\" ]"
check "详情含1个附件" "[ \"$(auth_get "$AT" /equipment/$NEWID | grep -o '\"original_name\"' | wc -l)\" -ge 1 ]"
check "viewer 上传被拒 403" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/equipment/$NEWID/documents" -H "Authorization: Bearer $VT" -F "file=@$TMP/manual.pdf")\" = 403 ]"
echo 'bad' > "$TMP/x.exe"
check "非法格式 .exe 拒绝 400" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/equipment/$NEWID/documents" -H "Authorization: Bearer $MT" -F "file=@$TMP/x.exe")\" = 400 ]"
check "viewer 可下载说明书 200" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $VT" "$BASE/api/equipment/$NEWID/documents/$DOCID/download")\" = 200 ]"
curl -s -H "Authorization: Bearer $MT" "$BASE/api/equipment/$NEWID/documents/$DOCID/download" -o "$TMP/dl.pdf"
check "下载内容与上传一致" "grep -q 'fake pdf' '$TMP/dl.pdf'"
check "viewer 删附件被拒 403" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/equipment/$NEWID/documents/$DOCID" -H "Authorization: Bearer $VT")\" = 403 ]"
curl -s -X DELETE "$BASE/api/equipment/$NEWID/documents/$DOCID" -H "Authorization: Bearer $MT" > /dev/null
check "主管删除附件成功" "[ \"$(auth_get "$AT" /equipment/$NEWID | grep -c original_name || true)\" -eq 0 ]"

echo "━━━━━━━━━━ 6. 用户管理 (admin) ━━━━━━━━━━"
TUSER="tester_$(date +%s)"
# 幂等：删除历史残留的测试账号 (tester01 及 tester_<ts>)
auth_get "$AT" /users > "$TMP/users.json"
node -e '
  const fs=require("fs");
  const users=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  console.log(users.filter(u=>/^tester01$|^tester_\d+$/.test(u.username)).map(u=>u.id).join(" "));
' "$TMP/users.json" | for OID in $(cat); do
  curl -s -X DELETE "$BASE/api/users/$OID" -H "Authorization: Bearer $AT" >/dev/null 2>&1 || true
done

UID2=$(curl -s -X POST "$BASE/api/users" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$TUSER\",\"displayName\":\"测试账号\",\"password\":\"Test@1234\",\"role\":\"viewer\"}" | jqget - id)
check "admin 创建用户成功" "[ -n \"$UID2\" ]"
check "重复用户名 409" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/users" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"username\":\"$TUSER\",\"displayName\":\"x\",\"password\":\"Test@1234\",\"role\":\"viewer\"}")\" = 409 ]"
check "弱密码 400" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/users" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d "{\"username\":\"${TUSER}x\",\"displayName\":\"x\",\"password\":\"123\",\"role\":\"viewer\"}")\" = 400 ]"
login "$TUSER" Test@1234 > "$TMP/t.json"
check "新用户可登录" "[ -n \"$(jqget "$TMP/t.json" token)\" ]"
curl -s -X PUT "$BASE/api/users/$UID2" -H "Authorization: Bearer $AT" -H 'Content-Type: application/json' -d '{"active":false}' > /dev/null
check "停用后登录被拒" "[ \"$(login "$TUSER" Test@1234 | jqget - error | grep -c 错误 || true)\" -ge 1 ]"
check "manager 不能管理用户 403" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/users/$UID2" -H "Authorization: Bearer $MT")\" = 403 ]"
AID=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).user.id)' "$TMP/admin.json")
check "不能删除自己 400" "[ \"$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/users/$AID" -H "Authorization: Bearer $AT")\" = 400 ]"

echo "━━━━━━━━━━ 7. 清理测试数据 ━━━━━━━━━━"
curl -s -X DELETE "$BASE/api/equipment/$NEWID" -H "Authorization: Bearer $AT" > /dev/null
curl -s -X DELETE "$BASE/api/users/$UID2" -H "Authorization: Bearer $AT" > /dev/null
check "测试用户已删除(404)" "[ \"$(code_get "$AT" /users)\" = 200 ]"
check "测试设备已删除，列表恢复6台" "[ \"$(auth_get "$AT" /equipment | jqget - total)\" = 6 ]"

echo
echo "════════ 结果: $PASS 通过, $FAIL 失败 ════════"
[ "$FAIL" -eq 0 ]
