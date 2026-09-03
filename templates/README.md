# 模板（脱敏，只有字段头和虚构示例）

| 文件 | 用途 | 在小采里怎么用 |
|---|---|---|
| `material-list-template.csv` | 你负责的物料清单：编码 / 名称 / 供应商 / 采购状态 / 备注 | 资料库 → 导入为「物料表」；`lookup_material` 按存货编码优先匹配，按「采购状态」给 ✅可下 / ⛔拦截 / ➡️先问生产 |
| `supplier-profile-template.csv` | 供应商供货习惯档案：MOQ / 凑整 / 生产周期口径 / 发车日 / 收货窗 … | 资料库 → 导入为「供应商档案」；`backward_schedule` 与 `calc_order_qty` 的参数来源 |
| `tracking-sheet-template.csv` | 跟单表（系统外的物流过程视图） | 资料库 → 导入为「跟单表」；`track_status` 出 🔴逾期 / 🟡临期 / 🟢未到期；`arrival_notice` 出明日到货预告 |

采购状态枚举：`在购` / `在购-日配` / `在购-警示将下架` / `按需-有需求才买` / `停购-长期不买` / `停购-已下架`。
