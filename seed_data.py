from datetime import datetime, timedelta

from extensions import db
from models.BOM import BOM
from models.Inventory import Inventory
from models.Product import Product
from models.Purchase import Purchase
from models.Sales import Sales
from models.Scrap_record import ScrapRecord
from models.Supplier import Supplier


def seed_database():
    now = datetime.utcnow()

    if not Product.query.first():
        products = [
            Product(product_id="P01", product_name="招牌涼麵", price=60),
            Product(product_id="P02", product_name="大碗涼麵", price=75),
            Product(product_id="P03", product_name="鍋燒意麵", price=85),
            Product(product_id="P04", product_name="咖哩飯", price=80),
            Product(product_id="P05", product_name="味噌湯", price=30),
        ]
        materials = [
            Inventory(material_id="M01", material_name="涼麵條", stock=12, safe_stock=4, unit="包", expiry_days=2),
            Inventory(material_id="M02", material_name="小黃瓜", stock=30, safe_stock=12, unit="條", expiry_days=3),
            Inventory(material_id="M03", material_name="麻醬", stock=8, safe_stock=3, unit="罐", expiry_days=7),
            Inventory(material_id="M04", material_name="醬油", stock=5, safe_stock=2, unit="罐", expiry_days=2),
            Inventory(material_id="M05", material_name="蒜泥", stock=4, safe_stock=2, unit="盒", expiry_days=3),
            Inventory(material_id="M06", material_name="辣油", stock=6, safe_stock=2, unit="罐", expiry_days=14),
            Inventory(material_id="M07", material_name="白飯", stock=18, safe_stock=6, unit="盒", expiry_days=1),
            Inventory(material_id="M08", material_name="雞蛋", stock=24, safe_stock=10, unit="顆", expiry_days=7),
            Inventory(material_id="M09", material_name="意麵", stock=15, safe_stock=5, unit="包", expiry_days=14),
        ]
        suppliers = [
            Supplier(supplier_id="S01", name="嘉義製麵行", phone="05-223-4567", contact="王先生", address="嘉義市西區"),
            Supplier(supplier_id="S02", name="新鮮蔬果行", phone="05-234-5678", contact="林小姐", address="嘉義市東區"),
            Supplier(supplier_id="S03", name="古早味醬料", phone="05-245-6789", contact="陳老闆", address="嘉義縣民雄鄉"),
        ]
        boms = [
            BOM(product_id="P01", material_id="M01", consume_qty=1 / 15),
            BOM(product_id="P01", material_id="M02", consume_qty=3 / 15),
            BOM(product_id="P01", material_id="M03", consume_qty=1 / 30),
            BOM(product_id="P01", material_id="M04", consume_qty=1 / 50),
            BOM(product_id="P02", material_id="M01", consume_qty=1.25 / 15),
            BOM(product_id="P02", material_id="M02", consume_qty=3.8 / 15),
            BOM(product_id="P03", material_id="M09", consume_qty=1),
            BOM(product_id="P03", material_id="M08", consume_qty=1),
            BOM(product_id="P04", material_id="M07", consume_qty=1),
        ]
        db.session.add_all(products + materials + suppliers + boms)
        db.session.commit()

    if not Sales.query.first():
        initial_records = [
            Sales(sale_id="SR-DEMO-001", product_id="P01", qty=3, subtotal=180, sale_date=now),
            Sales(sale_id="SR-DEMO-002", product_id="P02", qty=2, subtotal=150, sale_date=now),
            Sales(sale_id="SR-DEMO-003", product_id="P01", qty=5, subtotal=300, sale_date=now - timedelta(days=1)),
        ]
        db.session.add_all(initial_records)

        history = [
            ("P01", 8), ("P02", 5), ("P03", 3), ("P04", 4),
            ("P01", 11), ("P05", 6), ("P02", 7), ("P01", 9),
            ("P03", 4), ("P04", 5), ("P01", 12), ("P02", 6),
            ("P05", 8), ("P01", 10)
        ]
        prices = {"P01": 60, "P02": 75, "P03": 85, "P04": 80, "P05": 30}
        for index, (product_id, qty) in enumerate(history, start=1):
            db.session.add(Sales(
                sale_id=f"SR-HISTORY-{index:02d}",
                product_id=product_id,
                qty=qty,
                subtotal=prices[product_id] * qty,
                sale_date=now - timedelta(days=index + 1)
            ))

    purchases = [
        ("PO-DEMO-001", "S01", "M01", 8, "已下單", 0),
        ("PO-HISTORY-01", "S01", "M01", 10, "已驗收", 3),
        ("PO-HISTORY-02", "S02", "M02", 24, "已驗收", 6),
        ("PO-HISTORY-03", "S03", "M03", 6, "已驗收", 10),
        ("PO-HISTORY-04", "S01", "M09", 12, "已驗收", 13),
    ]
    for purchase_id, supplier_id, material_id, qty, status, days_ago in purchases:
        if not Purchase.query.get(purchase_id):
            db.session.add(Purchase(
                purchase_id=purchase_id,
                supplier_id=supplier_id,
                material_id=material_id,
                qty=qty,
                ordered_qty=qty,
                received_qty=qty if status in ("已驗收", "異常") else None,
                quality_note="歷史範例資料" if status in ("已驗收", "異常") else "",
                status=status,
                purchase_date=now - timedelta(days=days_ago)
            ))

    scraps = [
        ("M02", "小黃瓜", 1, "品質不佳", 1),
        ("M01", "涼麵條", 0.5, "保存期限到期", 5),
        ("M07", "白飯", 2, "當日未使用完", 9),
        ("M02", "小黃瓜", 2, "碰傷", 12),
    ]
    for material_id, name, qty, reason, days_ago in scraps:
        exists = ScrapRecord.query.filter_by(material_id=material_id, reason=reason).first()
        if not exists:
            db.session.add(ScrapRecord(
                material_id=material_id,
                material_name=name,
                quantity=qty,
                reason=reason,
                scrap_date=now - timedelta(days=days_ago)
            ))

    db.session.commit()
