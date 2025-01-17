import express from 'express';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import cookieParser from 'cookie-parser';
import { WebSocketServer, WebSocket } from 'ws';
import mongoose from 'mongoose';
import dotenv from 'dotenv';

// dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({
    origin: [
        "https://eventhandler-front-3mifmbad6-chris-projects-dbc5a559.vercel.app",
        "https://eventhandler-front-end.vercel.app"
    ],
    methods: ["POST", "GET", "PUT", "DELETE"],
    credentials: true
}));
app.use(cookieParser());

// MongoDB Connection
mongoose.connect("mongodb+srv://ChrisGreninja:pikachu@clusterchris.qsagm.mongodb.net/?retryWrites=true&w=majority&appName=ClusterChris")
    .then(() => console.log('Connected to MongoDB Atlas'))
    .catch(err => console.error('MongoDB connection error:', err));

// Define Schemas
const userSchema = new mongoose.Schema({
    name: String,
    email: { type: String, unique: true },
    password: String
});

const eventSchema = new mongoose.Schema({
    title: String,
    description: String,
    date: Date,
    time: String,
    location: String,
    category: String,
    user_id: mongoose.Schema.Types.ObjectId,
    creator_name: String,
    isForLoggedInOnly: Boolean,
    imageUrl: String
});

const attendeeSchema = new mongoose.Schema({
    event_id: mongoose.Schema.Types.ObjectId,
    user_id: mongoose.Schema.Types.ObjectId
});

// Create Models
const User = mongoose.model('User', userSchema);
const Event = mongoose.model('Event', eventSchema);
const Attendee = mongoose.model('Attendee', attendeeSchema);

// WebSocket setup
const wss = new WebSocketServer({ noServer: true });
let clients = [];

wss.on('connection', (ws) => {
    clients.push(ws);
    console.log('New WebSocket connection established');
    
    ws.on('close', () => {
        clients = clients.filter(client => client !== ws);
        console.log('Client disconnected');
    });
});

const sendAttendeeUpdate = (eventId, attendeeCount) => {
    const message = JSON.stringify({
        type: 'updateAttendees',
        eventId,
        count: attendeeCount
    });

    clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};

// Register route
app.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        
        if (!name || !email || !password) {
            return res.json({ Error: "Missing required fields" });
        }

        const hash = await bcrypt.hash(password, 10);
        
        const user = new User({
            name,
            email,
            password: hash
        });

        await user.save();
        res.json({ Status: "Success" });
    } catch (err) {
        console.error("Registration error:", err);
        res.json({ Error: "Error creating user" });
    }
});

// Login route
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        // Guest login handling
        if (email === 'guest@example.com' && password === 'guest') {
            const token = jwt.sign({ name: 'Guest', isGuest: true }, "secret-key", { expiresIn: '1d' });
            res.cookie('token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000
            });
            return res.json({ Status: "Success", isGuest: true });
        }

        const user = await User.findOne({ email });
        
        if (!user) {
            return res.json({ Error: "Email not found" });
        }

        const match = await bcrypt.compare(password, user.password);
        
        if (match) {
            const token = jwt.sign({ 
                userId: user._id, 
                name: user.name,
                isGuest: false 
            }, "secret-key", { expiresIn: '1d' });
            
            res.cookie('token', token, {
                httpOnly: true,
                secure: true,
                sameSite: 'none',
                maxAge: 24 * 60 * 60 * 1000
            });
            return res.json({ 
                Status: "Success",
                isGuest: false,
                name: user.name
            });
        } else {
            return res.json({ Error: "Password does not match" });
        }
    } catch (err) {
        console.error("Login error:", err);
        res.json({ Error: "Login error on server" });
    }
});

const verifyToken = (req, res, next) => {
    const token = req.cookies.token;
    if (!token) return res.json({ Error: "Authentication required" });

    jwt.verify(token, "secret-key", (err, decoded) => {
        if (err) return res.json({ Error: "Invalid token" });
        req.user = decoded;
        // Include isGuest in the response
        next();
    });
};

app.get('/', (req, res) => {
    res.json({
        msg: "hello"
    });
});

// User route
app.get('/user', verifyToken, (req, res) => {
    res.json({
        name: req.user.name,
        userId: req.user.userId,
        isGuest: req.user.isGuest || false
    });
});

// Events routes
app.get('/events', async (req, res) => {
    try {
        const token = req.cookies.token;
        let userId = null;

        if (token) {
            try {
                const decoded = jwt.verify(token, "secret-key");
                userId = decoded.userId;
            } catch (err) {
                console.error("Token verification error:", err);
            }
        }

        const query = userId ? {} : { isForLoggedInOnly: false };
        const events = await Event.find(query);
        res.json(events);
    } catch (err) {
        console.error("Error fetching events:", err);
        res.json({ Error: "Error fetching events" });
    }
});

// Single event route
app.get('/events/:id', async (req, res) => {
    try {
        const eventId = req.params.id;
        const token = req.cookies.token;
        let userId = null;

        if (token) {
            try {
                const decoded = jwt.verify(token, "secret-key");
                userId = decoded.userId;
            } catch (err) {
                console.error("Token verification error:", err);
            }
        }

        const event = await Event.findById(eventId);
        
        if (!event) {
            return res.json({ Error: "Event not found" });
        }

        if (event.isForLoggedInOnly && !userId) {
            return res.json({ Error: "This event is for logged-in users only" });
        }

        const attendeeCount = await Attendee.countDocuments({ event_id: eventId });
        const hasJoined = userId ? 
            await Attendee.exists({ event_id: eventId, user_id: userId }) : false;

        res.json({
            event,
            attendeeCount,
            hasJoined: !!hasJoined
        });
    } catch (err) {
        console.error("Error fetching event:", err);
        res.json({ Error: "Error fetching event" });
    }
});

// Get attendee counts
app.get('/events/attendees', async (req, res) => {
    try {
        const attendees = await Attendee.aggregate([
            {
                $group: {
                    _id: "$event_id",
                    count: { $sum: 1 }
                }
            }
        ]);

        console.log('Aggregation result:', attendees); // Add this debug log

        const attendeeCounts = {};
        attendees.forEach(item => {
            attendeeCounts[item._id] = item.count;
        });

        console.log('Formatted counts:', attendeeCounts); // Add this debug log
        res.json(attendeeCounts);
    } catch (err) {
        console.error("Error fetching attendee counts:", err);
        res.json({ Error: "Error fetching attendee counts" });
    }
});

app.get('/events/:id/attendees', async (req, res) => {
    try {
        const eventId = req.params.id;
        
        // Find all attendees for this event and populate user information
        const attendees = await Attendee.aggregate([
            {
                $match: { event_id: new mongoose.Types.ObjectId(eventId) }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'user_id',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            {
                $unwind: '$user'
            },
            {
                $project: {
                    user_name: '$user.name',
                    user_id: '$user._id'
                }
            }
        ]);

        res.json({ attendees });
    } catch (err) {
        console.error("Error fetching attendees:", err);
        res.json({ Error: "Error fetching attendees" });
    }
});

// Create event
app.post('/events/create', verifyToken, async (req, res) => {
    try {
        const { title, description, date, time, location, category, imageUrl, isForLoggedInOnly } = req.body;
        const userId = req.user.userId;
        const creatorName = req.user.name;

        if (!userId) {
            return res.json({ Error: "Must be logged in to create events" });
        }

        const event = new Event({
            title,
            description,
            date,
            time,
            location,
            category,
            user_id: userId,
            creator_name: creatorName,
            isForLoggedInOnly,
            imageUrl
        });

        await event.save();
        res.json({ Status: "Event created successfully!" });
    } catch (err) {
        console.error("Error creating event:", err);
        res.json({ Error: "Error creating event" });
    }
});

// Join event
app.post('/events/join', verifyToken, async (req, res) => {
    try {
        const { eventId } = req.body;
        const userId = req.user.userId;

        if (!userId) {
            return res.json({ Error: "Must be logged in to join events" });
        }

        const existingAttendee = await Attendee.findOne({ event_id: eventId, user_id: userId });
        
        if (existingAttendee) {
            return res.json({ Error: "You have already joined this event" });
        }

        const attendee = new Attendee({
            event_id: eventId,
            user_id: userId
        });

        await attendee.save();

        const attendeeCount = await Attendee.countDocuments({ event_id: eventId });
        
        sendAttendeeUpdate(eventId, attendeeCount);

        res.json({ 
            Status: "Successfully joined the event",
            attendeeCount
        });
    } catch (err) {
        console.error("Error joining event:", err);
        res.json({ Error: "Error joining event" });
    }
});

// Logout route
app.post('/logout', (req, res) => {
    res.clearCookie('token');
    res.json({ Status: "Logged out successfully" });
});

// Start server
const server = app.listen(8081, () => {
    console.log("Server running on port 8081...");
});

// Handle WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});
