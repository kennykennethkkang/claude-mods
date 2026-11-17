def import_rows(path):
    rows = []
    with open(path) as f:
        header = f.readline().strip().split(",")
        for line in f:
            if not line.strip():
                continue
            vals = line.strip().split(",")
            if len(vals) != len(header):
                continue
            row = dict(zip(header, vals))
            if row not in rows:
                rows.append(row)
    return rows
