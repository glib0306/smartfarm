# -*- coding: utf-8 -*-
"""Pure-Python numerical helpers (no numpy needed, works offline on Python 3.7):
   * simplex      - linear programming (max c.x, A.x <= b, x >= 0, b >= 0)
   * BPNet        - back-propagation neural network, 1 hidden layer
   * pls1         - partial least squares regression (NIPALS, single response)
   * least squares helpers
"""
import math
import random


# ----------------------------------------------------------------------------- linear programming
def simplex(c, A, b, max_iter=5000):
    """Maximise c.x subject to A.x <= b, x >= 0 (requires b >= 0).
    Returns (x, objective)."""
    m, n = len(A), len(c)
    # tableau rows: [A | I | b], last row: [-c | 0 | 0]
    T = []
    for i in range(m):
        row = list(A[i]) + [1.0 if j == i else 0.0 for j in range(m)] + [float(b[i])]
        T.append(row)
    T.append([-float(v) for v in c] + [0.0] * m + [0.0])
    basis = [n + i for i in range(m)]
    width = n + m + 1
    for _ in range(max_iter):
        last = T[-1]
        # entering variable: most negative reduced cost (Bland's rule on ties)
        col = -1
        best = -1e-9
        for j in range(width - 1):
            if last[j] < best:
                best, col = last[j], j
        if col < 0:
            break
        row = -1
        ratio = float("inf")
        for i in range(m):
            a = T[i][col]
            if a > 1e-12:
                r = T[i][-1] / a
                if r < ratio - 1e-12:
                    ratio, row = r, i
        if row < 0:
            raise ValueError("LP unbounded")
        piv = T[row][col]
        T[row] = [v / piv for v in T[row]]
        for i in range(m + 1):
            if i != row and abs(T[i][col]) > 1e-15:
                f = T[i][col]
                Ti, Tr = T[i], T[row]
                T[i] = [Ti[k] - f * Tr[k] for k in range(width)]
        basis[row] = col
    x = [0.0] * n
    for i, bv in enumerate(basis):
        if bv < n:
            x[bv] = T[i][-1]
    return x, T[-1][-1]


# ----------------------------------------------------------------------------- statistics
def mean(v):
    return sum(v) / float(len(v)) if v else 0.0


def std(v):
    if len(v) < 2:
        return 1.0
    mu = mean(v)
    s = math.sqrt(sum((x - mu) ** 2 for x in v) / (len(v) - 1))
    return s if s > 1e-12 else 1.0


def rmse(a, b):
    if not a:
        return 0.0
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)) / len(a))


def standardize(X):
    cols = list(zip(*X))
    mu = [mean(c) for c in cols]
    sd = [std(c) for c in cols]
    Z = [[(row[j] - mu[j]) / sd[j] for j in range(len(row))] for row in X]
    return Z, mu, sd


# ----------------------------------------------------------------------------- BP neural network
def _sig(x):
    if x < -40:
        return 0.0
    if x > 40:
        return 1.0
    return 1.0 / (1.0 + math.exp(-x))


class BPNet(object):
    """Fully connected net: n_in -> n_hidden (sigmoid) -> 1 (linear). Trained with SGD + momentum."""

    def __init__(self, n_in, n_hidden=8, seed=7):
        rnd = random.Random(seed)
        self.n_in, self.n_hidden = n_in, n_hidden
        self.W1 = [[rnd.uniform(-0.5, 0.5) for _ in range(n_in)] for _ in range(n_hidden)]
        self.b1 = [0.0] * n_hidden
        self.W2 = [rnd.uniform(-0.5, 0.5) for _ in range(n_hidden)]
        self.b2 = 0.0
        self.x_mu = self.x_sd = None
        self.y_mu, self.y_sd = 0.0, 1.0

    def _forward(self, x):
        h = [_sig(sum(w * xi for w, xi in zip(self.W1[k], x)) + self.b1[k]) for k in range(self.n_hidden)]
        return h, sum(w * hk for w, hk in zip(self.W2, h)) + self.b2

    def fit(self, X, y, epochs=300, lr=0.05, momentum=0.8, seed=11):
        Z, self.x_mu, self.x_sd = standardize(X)
        self.y_mu, self.y_sd = mean(y), std(y)
        t = [(v - self.y_mu) / self.y_sd for v in y]
        rnd = random.Random(seed)
        idx = list(range(len(Z)))
        vW1 = [[0.0] * self.n_in for _ in range(self.n_hidden)]
        vb1 = [0.0] * self.n_hidden
        vW2 = [0.0] * self.n_hidden
        vb2 = 0.0
        history = []
        for ep in range(epochs):
            rnd.shuffle(idx)
            loss = 0.0
            for i in idx:
                x = Z[i]
                h, out = self._forward(x)
                err = out - t[i]
                loss += err * err
                for k in range(self.n_hidden):
                    g2 = err * h[k]
                    gh = err * self.W2[k] * h[k] * (1 - h[k])
                    vW2[k] = momentum * vW2[k] - lr * g2
                    self.W2[k] += vW2[k]
                    for j in range(self.n_in):
                        vW1[k][j] = momentum * vW1[k][j] - lr * gh * x[j]
                        self.W1[k][j] += vW1[k][j]
                    vb1[k] = momentum * vb1[k] - lr * gh
                    self.b1[k] += vb1[k]
                vb2 = momentum * vb2 - lr * err
                self.b2 += vb2
            if ep % 25 == 0 or ep == epochs - 1:
                history.append({"epoch": ep, "mse": loss / len(Z)})
            lr *= 0.995
        return history

    def predict(self, x):
        z = [(x[j] - self.x_mu[j]) / self.x_sd[j] for j in range(self.n_in)]
        return self._forward(z)[1] * self.y_sd + self.y_mu

    def to_dict(self):
        return {"W1": self.W1, "b1": self.b1, "W2": self.W2, "b2": self.b2, "x_mu": self.x_mu, "x_sd": self.x_sd,
                "y_mu": self.y_mu, "y_sd": self.y_sd, "n_hidden": self.n_hidden}

    @classmethod
    def from_dict(cls, d):
        net = cls(len(d["x_mu"]), d["n_hidden"])
        for k in ("W1", "b1", "W2", "b2", "x_mu", "x_sd", "y_mu", "y_sd"):
            setattr(net, k, d[k])
        return net


# ----------------------------------------------------------------------------- PLS1 (NIPALS)
def pls1(X, y, n_comp=2):
    """Returns dict with regression coefficients on standardised X, intercept handling, VIP scores."""
    Z, mu, sd = standardize(X)
    ymu, ysd = mean(y), std(y)
    f = [(v - ymu) / ysd for v in y]
    n, p = len(Z), len(Z[0])
    E = [row[:] for row in Z]
    W, P, Q, T = [], [], [], []
    for _ in range(min(n_comp, p)):
        w = [sum(E[i][j] * f[i] for i in range(n)) for j in range(p)]
        nw = math.sqrt(sum(v * v for v in w)) or 1.0
        w = [v / nw for v in w]
        t = [sum(E[i][j] * w[j] for j in range(p)) for i in range(n)]
        tt = sum(v * v for v in t) or 1.0
        pl = [sum(E[i][j] * t[i] for i in range(n)) / tt for j in range(p)]
        qv = sum(f[i] * t[i] for i in range(n)) / tt
        for i in range(n):
            for j in range(p):
                E[i][j] -= t[i] * pl[j]
            f[i] -= t[i] * qv
        W.append(w)
        P.append(pl)
        Q.append(qv)
        T.append(t)
    a = len(W)
    # B = W (P'W)^-1 q  -- solve small a x a system by Gauss-Jordan
    PW = [[sum(P[r][j] * W[c][j] for j in range(p)) for c in range(a)] for r in range(a)]
    inv = _inverse(PW)
    coef_t = [sum(inv[r][c] * Q[c] for c in range(a)) for r in range(a)]
    B = [sum(W[r][j] * coef_t[r] for r in range(a)) for j in range(p)]
    # VIP
    ss = [Q[k] ** 2 * sum(v * v for v in T[k]) for k in range(a)]
    tot = sum(ss) or 1.0
    vip = [math.sqrt(p * sum(ss[k] * W[k][j] ** 2 for k in range(a)) / tot) for j in range(p)]

    def predict(x):
        z = [(x[j] - mu[j]) / sd[j] for j in range(p)]
        return sum(B[j] * z[j] for j in range(p)) * ysd + ymu

    fitted = [predict(x) for x in X]
    return {"coef_std": B, "vip": vip, "mu": mu, "sd": sd, "y_mu": ymu, "y_sd": ysd, "predict": predict,
            "rmse": rmse(fitted, y), "n_comp": a}


def _inverse(M):
    n = len(M)
    A = [list(M[i]) + [1.0 if j == i else 0.0 for j in range(n)] for i in range(n)]
    for c in range(n):
        piv = max(range(c, n), key=lambda r: abs(A[r][c]))
        A[c], A[piv] = A[piv], A[c]
        pv = A[c][c] if abs(A[c][c]) > 1e-12 else 1e-12
        A[c] = [v / pv for v in A[c]]
        for r in range(n):
            if r != c:
                fct = A[r][c]
                A[r] = [A[r][k] - fct * A[c][k] for k in range(2 * n)]
    return [row[n:] for row in A]
